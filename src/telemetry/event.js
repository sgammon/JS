
/*
 * Copyright 2017, Bloombox, LLC. All rights reserved.
 *
 * Source and object computer code contained herein is the private intellectual property
 * of Bloombox, a California Limited Liability Corporation. Use of this code in source form
 * requires permission in writing before use or the publishing of derivative works, for
 * commercial purposes or any other purpose, from a duly authorized officer of Momentum
 * Ideas Co.
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Bloombox Telemetry: Base Event
 *
 * @fileoverview Provides base logic for all events.
 */

/*global goog */

goog.require('bloombox.logging.log');

goog.require('bloombox.telemetry.Context');
goog.require('bloombox.telemetry.ContextException');
goog.require('bloombox.telemetry.OperationStatus');

goog.require('bloombox.telemetry.Routine');

goog.require('bloombox.telemetry.abort');
goog.require('bloombox.telemetry.enqueue');
goog.require('bloombox.telemetry.globalContext');

goog.require('bloombox.telemetry.rpc.TelemetryRPC');

goog.require('bloombox.util.Exportable');
goog.require('bloombox.util.generateUUID');
goog.require('bloombox.util.proto.merge');

goog.require('proto.analytics.Context');

goog.provide('bloombox.telemetry.BaseEvent');
goog.provide('bloombox.telemetry.FailureCallback');
goog.provide('bloombox.telemetry.SuccessCallback');
goog.provide('bloombox.telemetry.TelemetryEvent');


// - Type Definitions - //

/**
 * Success callback, specifying one parameter: the result of the operation we
 * are calling back from.
 *
 * @typedef {function(bloombox.telemetry.OperationStatus)}
 */
bloombox.telemetry.SuccessCallback;

/**
 * Failure callback, specifying three parameters: the result of the operation we
 * are calling back from, any known telemetry error, and the underlying HTTP
 * status code. In some cases, such as a timeout, all parameters may be `null`,
 * except for the first one, which would be provided in every case as either
 * `OK` or `ERROR`, enabling one function to be used as both a `SuccessCallback`
 * and `FailureCallback`.
 *
 * @typedef {function(
 *   bloombox.telemetry.OperationStatus,
 *   ?bloombox.telemetry.TelemetryError,
 *   ?number)}
 */
bloombox.telemetry.FailureCallback;


// - Interface: Sendable - //
/**
 * Specifies an interface for an object that may be sent via the telemetry
 * subsystem. Basically, this enforces the presence of a method, `send`, which
 * can be called with no parameters, to send whatever it is being called on.
 *
 * That entails a lot of hidden machinery - rendering context and payloads,
 * gathering global context, queueing, and so on. Most of that is implementation
 * specific, and this method makes it possible to treat those implementors
 * generically when it comes to sending data.
 *
 * @interface
 * @package
 */
bloombox.telemetry.Sendable = function() {};

/**
 * Send the subject data, with no regard for what happens afterwards. This is a
 * fire-and-forget interface. For callback-based dispatch, see `dispatch`.
 */
bloombox.telemetry.Sendable.prototype.send = function() {};


/**
 * Send the subject data, with callbacks attached for success and error
 * follow-up. For a fire-and-forget interface, see `send`.
 *
 * @param {?bloombox.telemetry.SuccessCallback} success Success callback.
 * @param {?bloombox.telemetry.FailureCallback} failure Failure callback.
 */
bloombox.telemetry.Sendable.prototype.dispatch = function(success, failure) {};


/**
 * Abort whatever in-flight request might be in-flight for this operation. This
 * calls into the underlying runtime with a best-effort guarantee.
 */
bloombox.telemetry.Sendable.prototype.abort = function() {};


// - Interface: Telemetry Event - //
/**
 * Basic interface for a Telemetry event. Every event eventually complies with
 * this interface. Some comply with more.
 *
 * @interface
 * @package
 */
bloombox.telemetry.TelemetryEvent = function() {};


/**
 * Generate an RPC transaction corresponding to this event, that reports its
 * encapsulated information to the telemetry service.
 *
 * @throws {bloombox.telemetry.ContextException} If required context is missing
 *         or context values are invalid.
 * @return {bloombox.telemetry.rpc.TelemetryRPC}
 */
bloombox.telemetry.TelemetryEvent.prototype.generateRPC = function() {};


/**
 * Every event is associated with an RPC method that is used to transmit it.
 * This method resolves the associated method for a given event.
 *
 * @return {bloombox.telemetry.Routine} RPC routine for this event.
 */
bloombox.telemetry.TelemetryEvent.prototype.rpcMethod = function() {};


/**
 * Every event is assigned a unique ID by the frontend, and later again by the
 * backend. This is mostly to keep track of individual events since objects are
 * frequently reused in the underlying runtime.
 *
 * @return {string} Final UUID to use for this event.
 */
bloombox.telemetry.TelemetryEvent.prototype.renderUUID = function() {};


/**
 * Every event carries context, which specifies common properties, like the
 * partner context or user state under which the event was recorded.
 *
 * Before the event is sent, `renderContext` is called to merge global context
 * with any event-specific context. The resulting object is used as the final
 * context when the event is sent shortly thereafter.
 *
 * @param {proto.analytics.Context} global Global context to merge onto.
 * @return {proto.analytics.Context} Combined/rendered event context.
 * @throws {bloombox.telemetry.ContextException} If required context is missing
 *         or context values are invalid.
 */
bloombox.telemetry.TelemetryEvent.prototype.renderContext = function(global) {};


/**
 * Most event types support the concept of a `payload`, which is arbitrary
 * object data detailing other information related to the event. The usage and
 * specification for the payload is event specific, so this method resolves that
 * for the generic case of rendering and sending those payloads.
 *
 * @return {?Object} Either `null`, indicating no payload should be attached, or
 * an object that is serializable via JSON.
 */
bloombox.telemetry.TelemetryEvent.prototype.renderPayload = function() {};


/**
 * Every event has a timestamp associated with when it occurred. This method
 * requests that value from an event, delegating its timing to code inside the
 * implementation of each event type.
 *
 * @param {number} now Timestamp for when this method is dispatched, in case the
 *        event would like to use that.
 * @return {number} Millisecond-resolution timestamp to use for this event.
 */
bloombox.telemetry.TelemetryEvent.prototype.renderOccurrence = function(now) {};



// - Base Classes: Base Event - //
// noinspection GjsLint
/**
 * Basic constructor for every kind of event. Context is accepted, along with
 * the option for a payload and an explicit timestamp. If a timestamp for event
 * occurrence is not provided, one is generated.
 *
 * @param {bloombox.telemetry.Context} context Context to apply to this event.
 * @param {bloombox.telemetry.Routine} method RPC method for this event.
 * @param {Object=} opt_payload Optional payload to attach to this event.
 * @param {number=} opt_occurred Optional explicit occurrence timestamp to
 *        specify for this event.
 * @param {string=} opt_uuid Optional explicit UUID for this specific event.
 *        If one is not provided, one will be generated by this method.
 * @implements {bloombox.telemetry.TelemetryEvent}
 * @implements {bloombox.telemetry.Sendable}
 * @implements {bloombox.util.Exportable<T>}
 * @template T
 * @constructor
 * @abstract
 * @public
 */
bloombox.telemetry.BaseEvent = function(context,
                                        method,
                                        opt_payload,
                                        opt_occurred,
                                        opt_uuid) {
  /**
   * Unique ID for this event.
   *
   * @type {string}
   * @protected
   */
  this.uuid = opt_uuid || bloombox.util.generateUUID();

  /**
   * RPC method to dispatch when transmitting this event.
   *
   * @type {bloombox.telemetry.Routine}
   * @protected
   */
  this.operation = method;

  /**
   * Context to apply for this event.
   *
   * @type {bloombox.telemetry.Context}
   * @protected
   */
  this.context = context;

  // freeze the payload if we are given one
  if (opt_payload && Object.isFrozen && !Object.isFrozen(opt_payload))
    Object.freeze(opt_payload);

  /**
   * Payload to attach to this event, if any.
   *
   * @type {?Object}
   * @protected
   */
  this.payload = opt_payload || null;

  /**
   * Context to apply for this event.
   *
   * @type {number}
   * @protected
   */
  this.occurred = opt_occurred || +(new Date);

  /**
   * Success callback to dispatch, if any.
   *
   * @type {?bloombox.telemetry.SuccessCallback}
   */
  this.successCallback = null;

  /**
   * Failure callback to dispatch, if any.
   *
   * @type {?bloombox.telemetry.FailureCallback}
   */
  this.failureCallback = null;
};


// - Base Event: Abstract Methods - //
// noinspection GjsLint
/**
 * Retrieve this event's corresponding RPC method.
 *
 * @return {bloombox.telemetry.Routine} RPC routine for this ev ent.
 * @public
 * @abstract
 */
bloombox.telemetry.BaseEvent.prototype.rpcMethod = function() {};


// noinspection GjsLint
/**
 * Abstract base method of proto/struct export, which must be defined on every
 * event implementor of `BaseEvent`.
 *
 * @return {T}
 * @public
 * @abstract
 */
bloombox.telemetry.BaseEvent.prototype.export = function() {};


// noinspection GjsLint
/**
 * Abstract base method to provide the attached payload, if any, as the final
 * payload to send for the event.
 *
 * @abstract
 * @return {?Object} Either `null`, indicating no payload should be attached, or
 * the attached payload object, provided at construction time.
 * @public
 */
bloombox.telemetry.BaseEvent.prototype.renderPayload = function() {};


// - Base Event: Default Implementations - //
/**
 * Default implementation. Success callback dispatcher.
 *
 * @param {bloombox.telemetry.OperationStatus} status Status of the operation we
 *        are calling back from.
 * @public
 */
bloombox.telemetry.BaseEvent.prototype.onSuccess = function(status) {
  // if there is a success callback attached, call it
  if (this.successCallback && typeof this.successCallback === 'function')
    this.successCallback(status);
  this.successCallback = null;
};


/**
 * Default implementation. Failure callback dispatcher.
 *
 * @param {bloombox.telemetry.OperationStatus} op Status of the operation we are
 *        calling back from.
 * @param {?bloombox.telemetry.TelemetryError} error Known error, if any.
 * @param {?number} code Status code of the underlying RPC, if any.
 * @public
 */
bloombox.telemetry.BaseEvent.prototype.onFailure = function(op, error, code) {
  // if there is a failure callback attached, call it
  if (this.failureCallback && typeof this.failureCallback === 'function')
    this.failureCallback(op, error, code);
  this.failureCallback = null;
};


/**
 * Encode an array of unsigned 8-bit integers (a.k.a. 'bytes'), and return
 * it base64 encoded.
 *
 * @param {Uint8Array} u8a Array of bytes.
 * @return {string} Base64-encoded, UTF-8 encoded bytes.
 * @private
 */
bloombox.telemetry.BaseEvent.prototype.encodeUint8Array_ = function(u8a) {
  let CHUNK_SZ = 0x8000;
  let c = [];
  for (let i = 0; i < u8a.length; i += CHUNK_SZ) {
    c.push(String.fromCharCode.apply(null, u8a.subarray(i, i + CHUNK_SZ)));
  }
  return btoa(c.join(''));
};


/**
 * Default implementation. Generate a `TelemetryRPC` suitable for fulfilling
 * the transmission of this `BaseEvent` to the telemetry service.
 *
 * @return {bloombox.telemetry.rpc.TelemetryRPC}
 * @throws {bloombox.telemetry.ContextException} If required context is missing
 *         or context values are invalid.
 */
bloombox.telemetry.BaseEvent.prototype.generateRPC = function() {
  // fetch global context and render
  let globalContext = bloombox.telemetry.globalContext().export();
  let mergedContext = this.renderContext(globalContext);

  let rpcMethod = this.rpcMethod();
  let rpcPayload = this.renderPayload();
  let uuid = this.renderUUID();

  let renderedContext = (
    bloombox.telemetry.Context.serializeProto(mergedContext));

  let resolvedPayload = rpcPayload === null ? {} : rpcPayload;
  let body = Object.assign({}, resolvedPayload,
    {'context': renderedContext});

  // @TEST: test code for binary encoding
  let binaryEncoded = mergedContext.serializeBinary();
  let b64encoded = this.encodeUint8Array_(binaryEncoded);

  let currentLength = JSON.stringify(body).length;
  let reducedLength = (
    JSON.stringify(Object.assign({}, {'payload': body['payload']})).length);

  bloombox.logging.log('Preparing RPC.', {
    'payloads': {
      'current': body,
      'context': b64encoded
    },
    'comparison': {
      'current': currentLength,
      'b64encoded': b64encoded.length,
      'reduced': (currentLength > reducedLength) ?
        (currentLength - reducedLength) : (reducedLength - currentLength),
      'next': reducedLength
    }
  });

  return new bloombox.telemetry.rpc.TelemetryRPC(
    uuid,
    rpcMethod,
    this.onSuccess,
    this.onFailure,
    body,
    mergedContext);
};

/**
 * Default implementation. Send this data to the telemetry service, with an
 * attached success and failure callback.
 *
 * @param {?bloombox.telemetry.SuccessCallback} success Callback to dispatch if
 *        the underlying runtime reports success.
 * @param {?bloombox.telemetry.FailureCallback} failure Callback to dispatch if
 *        some error or failure is encountered.
 * @throws {bloombox.telemetry.ContextException} If required context is missing
 *         or context values are invalid.
 * @public
 */
bloombox.telemetry.BaseEvent.prototype.dispatch = function(success, failure) {
  this.successCallback = success || null;
  this.failureCallback = failure || null;
  let rpc = this.generateRPC();
  bloombox.telemetry.enqueue(rpc);
};

/**
 * Default implementation. Abort any underlying in-flight request for this
 * event, on a best-effort basis.
 *
 * @public
 */
bloombox.telemetry.BaseEvent.prototype.abort = function() {
  let uuid = this.renderUUID();
  bloombox.telemetry.abort(uuid);
};


/**
 * Default implementation. Use this event's pre-generated UUID for its
 * underlying UUID.
 *
 * @return {string} Pre-generated or explicitly provided UUID.
 */
bloombox.telemetry.BaseEvent.prototype.renderUUID = function() {
  return this.uuid;
};


/**
 * Default implementation. Fire-and-forget this data, by sending it to the
 * telemetry service.
 *
 * @throws {bloombox.telemetry.ContextException} If required context is missing
 *         or context values are invalid.
 * @public
 */
bloombox.telemetry.BaseEvent.prototype.send = function() {
  this.dispatch(null, null);
};

/**
 * Default implementation. Render event context by returning any attached
 * payload object, or `null`, to indicate there is no payload.
 *
 * @param {proto.analytics.Context} global Global context.
 * @return {proto.analytics.Context} Combined/rendered event context.
 * @throws {bloombox.telemetry.ContextException} If required context is missing
 *         or context values are invalid.
 * @public
 */
bloombox.telemetry.BaseEvent.prototype.renderContext = function(global) {
  let local = /** @type {proto.analytics.Context} */ (this.context.export());
  let merged = bloombox.util.proto.merge(local, global);
  this.validateContext(merged);
  return merged;
};


/**
 * Validate final event context before allowing it to return.
 *
 * @param {proto.analytics.Context} context Final context to validate.
 * @throws {bloombox.telemetry.ContextException} If required context is missing
 *         or context values are invalid.
 * @protected
 */
bloombox.telemetry.BaseEvent.prototype.validateContext = function(context) {
  // fingerprint and session are always required
  if (!context.getFingerprint())
    throw new bloombox.telemetry.ContextException(
      'Missing device fingerprint ID.');
  if (!context.getGroup())
    throw new bloombox.telemetry.ContextException(
      'Missing device session ID.');
};


/**
 * Default implementation. Render the occurrence timestamp for this event,
 * howsoever this event defines that value. By default, the occurrence timestamp
 * provided or generated at event construction time is used. If that is not a
 * valid value, `now` is returned, which is provided by the runtime when this
 * method is dispatched.
 *
 * @param {number} now Millisecond-level timestamp for when this method is
 *        dispatched.
 * @return {number} Timestamp to use for this event's occurrence.
 * @public
 */
bloombox.telemetry.BaseEvent.prototype.renderOccurrence = function(now) {
  return this.occurred || now;
};
