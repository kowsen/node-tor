// Handles circuit creation. Makes it transparent to the proxy
// that it is sending data through the tor network. Instead, it
// provides the HTTPStream abstraction so the proxy believes it
// is sending / receiving data to and from something that resembles
// a typical socket.

var getConnection = require('./ConnectionManager').getConnection;
var getRandomRouter = require('./RouterManager').getRandomRouter;
var constants = require('./helpers/Constants');
var readOps = require('./helpers/CellReadOperations');
var makeOps = require('./helpers/CellMakeOperations');

var setInitialCallback = require('./RouterManager').setInitialCallback;

var types = constants.types;
var relayTypes = constants.relayTypes;
var LOGGING = constants.glob.LOGGING;

var packetString = require('./helpers/PacketPrinter').packetString;

// streamID -> array with stream information
// {status, requests, closecallback}
var streams = {};

// Will always be 0 - this router sees all incoming HTTP requests as
// being to/from a socket 0.
var socketID = 0;

// Increment each time we destroy and remake a circuit
var circuitID = 1;

// The length of a completed circuit
var COMPLETED_CIRCUIT_LENGTH = 3;

// The entry point of the circuit
var circuitEntry;

// The current length of the circuit
var circuitLength = 0;

// Gets set to true during teardown so we'll ignore messages coming in
var closed = false;

// If we're logging debug information in this class
var isDebug = (LOGGING === '-a' || LOGGING === '-c');

// Routers we have failed to connect to and thus don't want to try connecting to again
var invalidList = [];

// The last router we attempted a connect to, used for debug printing
var lastRouter;

// The ID we expect responses from our circuitEntry to be
var otherID;

// The current router chain, used for debug printing
var chain = [];

function printDebug(message) {
	if(isDebug) {
		if(message) {
			console.log(message);
		} else {
			console.log();
		}
	}
}

// Constructs a nice string representation of a router
function routerString(router) {
	return("IP: " + router.connectInfo.ip + ", Port: " + router.connectInfo.port + ", Agent: 0x" + router.agent.toString(16));
}

// Creates the first hop in our circuit
// If isRecreate is true, updates our circuit number, invalid list, and the
// circuit IDs of all messages in the unsent queue
function createFirstHop(isRecreate) {
	if(isRecreate) {
		for(var key in streams) {
			streams[key].updateCircuit(circuitID);
		}
	}
	circuitID++;
	circuitEntry = undefined;
	circuitLength = 0;
	lastRouter = getRandomRouter(invalidList);
	printDebug("Connecting to " + routerString(lastRouter) + "...");
	getConnection(lastRouter.agent, lastRouter.connectInfo, function(status, establisher) {
		// This message is coming in late, potentially our timeout is too fast.
		// Regardless, we've already moved on, so this should be ignored.
		if(circuitLength >= COMPLETED_CIRCUIT_LENGTH) {
			return;
		}
		// if we did not successfully connect
		if(status === 'failure') {
			// try again
			printDebug("Connect failed, trying different router\n");
			invalidList.push(lastRouter);
			createFirstHop();
		} else {
			// Register our handler with the socket, and send a create message
			var create = makeOps.constructCreate(circuitID);
			establisher.registerHandler(circuitID, socketID, function(status, message) {
				responseHandler(status, message, establisher);
			});
			establisher.sendMessage(socketID, create);
		}
	});
}

// Sends an extend message to a random router through our existing partial circuit
function extendCircuit() {
	if(circuitEntry && circuitEntry.sendMessage) {
		lastRouter = getRandomRouter(invalidList);
		printDebug("Extending to " + routerString(lastRouter) + "...");
		var extendBody = makeOps.constructRelayBody(lastRouter.connectInfo.ip, lastRouter.connectInfo.port, lastRouter.agent);
		var extend = makeOps.constructRelayExtend(circuitID, extendBody);
		circuitEntry.sendMessage(socketID, extend);
	}
}

// Handles responses coming back to our end of the circuit
function responseHandler(status, message, establisher) {
	// Ignore if we're tearing down or it's an old message
	if(closed || (otherID && readOps.getCircuit(message) !== otherID)) {
		// console.log("Expected " + circuitID + ", got: " + readOps.getCircuit(message));
		return;
	}
	if(status === 'success') {
		var type = readOps.getType(message);
		if(type === types.relay) {
			var relayType = readOps.getRelayCommand(message);
			var streamID = readOps.getStreamID(message);
			if(relayType === relayTypes.data) {
				// received data
				// send to HTTPEndpoint
				var body = readOps.getBodyBuffer(message);
				var stream = streams[streamID];
				if(stream) {
					stream.respond(body);
				}
			} else if(relayType === relayTypes.connected) {
				// success for stream creation
				// send everything in request queue for this streamID
				if(streams[streamID]) {
					streams[streamID].status = 'ready';
					streams[streamID].begin();
					sendQueue();
				}
			} else if(relayType === relayTypes.begin_failed || relayType === relayTypes.end) {
				// Destroy this stream
				var stream = streams[streamID];
				if(stream) {
					stream.close();
				}
				
			} else if(relayType === relayTypes.extended) {
				// Ignore if our circuit is finished, means this is a late callback
				if(circuitLength >= COMPLETED_CIRCUIT_LENGTH) {
					return;
				}

				printDebug("Successfully extended!\n");
				if(isDebug) {
					chain[circuitLength] = lastRouter.agent;
				}
				circuitLength++;

				// Keep extending if we don't have a complete circuit
				if(circuitLength < COMPLETED_CIRCUIT_LENGTH) {
					extendCircuit();
				} else {
					// circuit is complete
					printDebug("Circuit Established:");
					inalidList = [];
					if(isDebug) {
						for(var i = 0; i < chain.length; i++) {
							printDebug("\tAgent: 0x" + chain[i].toString(16));
						}
					}
					printDebug();
					sendQueue();
				}
			} else if(relayType === relayTypes.extend_failed) {
				if(circuitLength >= COMPLETED_CIRCUIT_LENGTH) {
					return;
				}
				printDebug("Extend failed, trying different router.\n");
				invalidList.push(lastRouter);
				extendCircuit();
			}
		} else if(type === types.created) {
			if(circuitLength > 0) {
				return;
			}
			printDebug("Successfully created!\n");
			otherID = readOps.getCircuit(message);
			// success for first hop
			if(isDebug) {
				//printDebug("Connected to: 0x" + lastRouter.agent.toString(16));
				chain[0] = lastRouter.agent;
			}
			circuitEntry = establisher;
			circuitLength = 1;
			extendCircuit();
		} else if(type === types.create_failed) {
			// failure for first hop
			invalidList.push(lastRouter);
			if(isDebug) {
				printDebug("Create failed, trying different router.\n");
			}
			createFirstHop();
		}
	} else if(status === 'ended') {
		for(var key in streams) {
			streams[key].status = 'primed';
		}
		otherID = undefined;
		if(circuitLength > 0 && circuitLength < COMPLETED_CIRCUIT_LENGTH) {
			invalidList.push(lastRouter);
		}
		printDebug(packetString(message));
		printDebug("Circuit broken, remaking...\n");
		createFirstHop(true);
	}
}

// Send our queue of messages through the circuit
// if we have a full circuit.
// Should be called when we get a message and have a completed
// circuit, or when we complete our circuit
function sendQueue() {
	if(circuitLength === COMPLETED_CIRCUIT_LENGTH) {
		// printDebug("SENDING QUEUE, CIRCUIT COMPLETE");
		for(var key in streams) {
			var stream = streams[key];
			// Stream is created
			if(stream.status === 'ready' || stream.status === 'ending') {
				while(stream.getRequestCount() > 0) {
					if(circuitLength !== COMPLETED_CIRCUIT_LENGTH) {
						return;
					}
					var message = stream.shiftRequest();
					circuitEntry.sendMessage(socketID, message);
				}
				if(stream.status === 'ending') {
					stream.close();
				}
			// Stream is not created, and is not waiting for a begin response
			} else if(stream.status === 'primed') {
				stream.status = 'waiting';
				circuitEntry.sendMessage(socketID, stream.getBeginMessage());
			}
		}
	}
}

// Ignore all future responses.
function close() {
	closed = true;
}

// An interface that resembles a net socket, but is instead used to send data
// over the tor network. Can be used anywhere a socket was used in the proxy
// code, except it needs to be given a unique streamID.
// Buffers requests from the proxy unless we have a complete tor circuit, and
// buffers messages from tor unless the proxy has registered a data listener
function HTTPStream(streamID, host, port, openCallback) {

	var self = this;

	var callbacks = {};

	var beginMessage;
	var requests = [];
	var responseQueue = [];

	this.status = 'primed';

	// update the circuit ID of all messages in the request queue
	// as well as the begin message
	this.updateCircuit = function(newID) {
		makeOps.modifyCircuitID(beginMessage, newID);
		for(var i = 0; i < requests.length; i++) {
			makeOps.modifyCircuitID(requests[i], newID);
		}
	};

	this.begin = function() {
		openCallback();
	};

	this.pushRequest = function(request) {
		requests.push(request);
	};

	this.shiftRequest = function() {
		return requests.shift();
	};

	this.getRequestCount = function() {
		return requests.length;
	};

	this.getBeginMessage = function() {
		return beginMessage;
	};

	// Used by the proxy to send into tor
	this.write = function(data, callback) {
		if(self.status !== 'closed' && self.status !== 'ending') {
			var dataCell = makeOps.constructRelayData(circuitID, streamID, new Buffer(data));
			requests.push(dataCell);

			sendQueue();
		}
	};

	// Send back to the proxy
	this.respond = function(response) {
		responseQueue.push(response);
		sendResponseQueue();
	};

	this.on = function(event, callback) {
		callbacks[event] = callback;
	};

	this.removeListener = function(event) {
		delete callbacks[event];
	};

	// Sends an end message over Tor
	this.end = function() {
		if(self.status !== 'ending' && self.status !== 'closed') {
			var streamEnd = makeOps.constructRelayEnd(circuitID, streamID);
			requests.push(streamEnd);
			self.status = 'ending';

			sendQueue();
		}
	};

	// closes the stream
	this.close = function(callback) {
		if(callbacks.close) {
			callbacks.close();
			delete streams[streamID];
			self.status = 'closed';
		}
	};

	// Send everything in response queue to the data listener
	function sendResponseQueue() {
		if(callbacks.data) {
			while(responseQueue.length > 0) {
				if(!callbacks.data) {
					return;
				}
				var data = responseQueue.shift();
				callbacks.data(data);
			}
		}
	}

	var body = makeOps.constructRelayBody(host, port);
	beginMessage = makeOps.constructRelayBegin(circuitID, streamID, body);

	streams[streamID] = this;

	sendQueue();
}

// Don't create first hop until registration service has made its initial router fetch
setInitialCallback(createFirstHop);

module.exports = {
	HTTPStream : HTTPStream,
	close : close
};