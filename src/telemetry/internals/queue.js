
/**
 * Bloombox Telemetry: Event Queue
 *
 * @fileoverview Provides RPC tools for managing a pool of XHRs.
 */

goog.require('bloombox.logging.log');

goog.require('bloombox.telemetry.BATCH_SIZE');
goog.require('bloombox.telemetry.rpc.TelemetryRPC');
goog.require('bloombox.util.generateUUID');

goog.require('goog.structs.PriorityQueue');

goog.provide('bloombox.telemetry.internals.EventQueue');
goog.provide('bloombox.telemetry.internals.QueuedEvent');

goog.provide('bloombox.telemetry.prepareQueuedEvent');


/**
 * Enqueue a Telemetry RPC for fulfillment. This util method will also generate
 * a UUID for the transaction if one is not provided.
 *
 * @param {bloombox.telemetry.rpc.TelemetryRPC} rpc RPC to fulfill.
 * @param {string=} opt_uuid UUID to use. If not provided, it will be generated.
 * @return {bloombox.telemetry.internals.QueuedEvent} Event, ready to send.
 * @public
 */
bloombox.telemetry.prepareQueuedEvent = function(rpc, opt_uuid) {
  let uuid = opt_uuid === undefined ? bloombox.util.generateUUID() : opt_uuid;
  return new bloombox.telemetry.internals.QueuedEvent(uuid, rpc);
};


/**
 * Event queued to be sent with its RPC.
 *
 * @param {string} uuid UUID for this event.
 * @param {bloombox.telemetry.rpc.TelemetryRPC} rpc RPC object to enqueue.
 * @constructor
 * @package
 */
bloombox.telemetry.internals.QueuedEvent = function QueuedEvent(uuid, rpc) {
  /**
   * RPC that is enqueued-to-send.
   *
   * @type {bloombox.telemetry.rpc.TelemetryRPC}
   */
  this.rpc = rpc;

  /**
   * UUID for this event.
   *
   * @type {string}
   */
  this.uuid = uuid;
};

/**
 * Queue for event RPCs that are due to be sent to the Telemetry Service.
 *
 * @constructor
 * @package
 */
bloombox.telemetry.internals.EventQueue = function EventQueue() {
 /**
  * Internal priority queue that holds events-to-be-sent.
  *
  * @type {goog.structs.PriorityQueue<bloombox.telemetry.internals.QueuedEvent>}
  */
 this.queue = new goog.structs.PriorityQueue();
};


/**
 * Enqueue an RPC for a telemetry event.
 *
 * @param {number} priority Priority value for this RPC.
 * @param {bloombox.telemetry.internals.QueuedEvent} ev Event to enqueue.
 * @package
 */
bloombox.telemetry.internals.EventQueue.prototype.enqueue = function(priority,
                                                                     ev) {
  this.queue.enqueue(priority, ev);
  bloombox.logging.log('Enqueued telemetry event with UUID: ' + ev.uuid + '.');
};


/**
 * Dequeue an RPC for a telemetry event, so it can be dispatched.
 *
 * @param {function(bloombox.telemetry.internals.QueuedEvent)} mapper Mapper
 *        function to handle each dequeued event.
 * @param {number=} opt_amt Number of events to dequeue. Defaults to the
 *        default batch size which is configurable from the telemetry base
 *        settings.
 * @package
 */
bloombox.telemetry.internals.EventQueue.prototype.dequeue = function(mapper,
                                                                     opt_amt) {
  let countToDequeue = opt_amt === undefined ? (
    bloombox.telemetry.BATCH_SIZE) : opt_amt;

  while (countToDequeue > 0) {
    let ev = this.queue.dequeue();
    mapper(ev);

    // ok dequeue the next one
    countToDequeue--;
  }
};