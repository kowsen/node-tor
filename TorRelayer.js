// Handles the relaying job of a Tor socket. Any message that
// isn't a response should funnel through here, and be handled
// accordingly. If we aren't the endpoint, it sends it to the
// TorEstablisher for the appropriate port, and if we are the
// end point, it sends it to HTTPEndpoint for handling.

var constants = require('./helpers/Constants');
var readOps = require('./helpers/CellReadOperations');
var makeOps = require('./helpers/CellMakeOperations');
var checkOps = require('./helpers/CellCheckOperations');
var httpEndpoint = require('./HTTPEndpoint');
var getConnection;

var types = constants.types;
var relayTypes = constants.relayTypes;

// Handles the creation and management of circuits that go in from another
// router through this socket.
function TorRelayer(torSocket) {
	// Which Tor/Http socket to send information we receive on this socket to
	// circuitNum -> torEstablisher
	var incomingRoutingTable = {};

	this.handleMessage = function(message) {
		var type = readOps.getType(message);
		if(type === types.relay) {
			handleRelay(message);
		} else if(type === types.create) {
			handleCreate(message);
		} else if(type === types.destroy) {
			handleDestroy(message);
		} else {
			//console.log("Received invalid type message for an unmade circuit: " + type);
		}
	};

	this.cleanup = function() {
		for(var key in incomingRoutingTable) {
			var func = incomingRoutingTable[key];
			if(typeof(func) === 'function') {
				var destroy = makeOps.contructDestroy(key);
				func(destroy);
			}
		}
	};

	function handleDestroy(message) {
		var circuitID = readOps.getCircuit(message);
		var establisher = incomingRoutingTable[circuitID];
		// If we have a circuit for this ID
		if(establisher) {
			if(circuitID !== undefined) {
				//console.log("Destroying circuit " + circuitID + " on socket " + torSocket.getID());
				// Delete it from our records
				delete incomingRoutingTable[circuitID];
				// Pass it along
				if(establisher.sendMessage) {
					establisher.sendMessage(torSocket.getID(), message);
				}
			}
		}
	}

	function handleCreate(message) {
		var circuitID = readOps.getCircuit(message);

		// primes our table
		incomingRoutingTable[circuitID] = 'primed'

		// returns a created response
		var created = makeOps.constructCreated(circuitID);
		torSocket.write(created);
	}

	function handleRelay(message) {
		var circuitNum = readOps.getCircuit(message);
		// If this circuit is already extended 
		if(typeof(incomingRoutingTable[circuitNum]) === 'object') {
			// have a generic relay response handler, or one that switches based on message
			incomingRoutingTable[circuitNum].sendMessage(torSocket.getID(), message);
		} else {
			// We are the endpoint and need to handle the relay
			var relayType = readOps.getRelayCommand(message);
			if(relayType === relayTypes.begin) {
				handleRelayBegin(message);
			} else if(relayType === relayTypes.end) {
				handleRelayEnd(message);
			} else if(relayType === relayTypes.extend) {
				handleRelayExtend(message);
			} else if(relayType === relayTypes.data) {
				handleRelayData(message);
			}
		}
	}

	// These handlers only get called if we are the relay endpoint
	function handleRelayExtend(message) {
		var circuitNum = readOps.getCircuit(message);
		var destination = incomingRoutingTable[circuitNum];
		if(destination === 'primed') {
			if(!getConnection) {
				getConnection = require('./ConnectionManager').getConnection;
			}
			// construct a create from the body, send to correct port based on agent
			getConnection(readOps.getExtendAgent(message), readOps.getExtendHost(message), function(status, establisher) {
				if(status === 'success') {
					// use establisher to send a create packet with a handler that
					// listens for a create success and relays it as a relay extended
					// and also adds us to incomingRoutingTable
					establisher.registerHandler(circuitNum, torSocket.getID(), function(status, response) {
						responseHandler(status, response, circuitNum, establisher);
					});

					var create = makeOps.constructCreate(circuitNum);
					establisher.sendMessage(torSocket.getID(), create);
				} else {
					var extendFailed = makeOps.constructRelayExtendFailed(circuitNum);
					torSocket.write(extendFailed);
				}
			});
		} else {
			var extendFailed = makeOps.constructRelayExtendFailed(circuitNum);
			torSocket.write(extendFailed);
		}
	}

	function handleRelayBegin(message) {
		// create our http connection
		// respond with a connected or begin failed
		var connectInfo = readOps.getBodyString(message).split(":");
		if(parseInt(connectInfo[1]) >= 65535) {
			console.log("Port is invalid. Fudging to 80.");
			connectInfo[1] = 80;
		}
		var streamID = readOps.getStreamID(message);
		var circuitID = readOps.getCircuit(message);
		httpEndpoint.beginStream(torSocket.getID(), circuitID, streamID, connectInfo[0], parseInt(connectInfo[1]), function(type, data) {
			var response;
			if(type === 'connected') {
				response = makeOps.constructRelayConnected(circuitID, streamID);
			} else if(type === 'failed') {
				response = makeOps.constructRelayBeginFailed(circuitID, streamID);
			} else if(type === 'end') {
				response = makeOps.constructRelayEnd(circuitID, streamID);
			} else if(type === 'data') {
				for(var i = 0; i < data.length; i += 65535) {
					var trimmedData = data.slice(i, Math.min(i + 65535, data.length));
					response = makeOps.constructRelayData(circuitID, streamID, trimmedData);
					torSocket.write(response);
				}
				return;
			}
			torSocket.write(response);
		});
	}

	function handleRelayEnd(message) {
		// pass along the end command
		var circuitID = readOps.getCircuit(message);
		httpEndpoint.endStream(torSocket.getID(), circuitID, readOps.getStreamID(message));
	}

	function handleRelayData(message) {
		// pass along the data
		var circuitID = readOps.getCircuit(message);
		var streamID = readOps.getStreamID(message);
		var body = readOps.getBodyBuffer(message);
		httpEndpoint.receiveData(torSocket.getID(), circuitID, streamID, body);
	}

	function responseHandler(status, message, circuitID, establisher) {
		var type = readOps.getType(message);
		var toSend;

		if(status === 'success' || status === 'failure') {

			if(type === types.created) {
				// send extended
				toSend = makeOps.constructRelayExtended(circuitID);
				if(incomingRoutingTable[circuitID] === 'primed') {
					incomingRoutingTable[circuitID] = establisher;
				}
			} else {
				// send through
				toSend = message;
				makeOps.modifyCircuitID(toSend, circuitID);
			}

		} else if(status === 'ended') {

			if(type === types.create_failed) {
				// send extend failed
				toSend = makeOps.constructRelayExtendFailed(circuitID);
			} else {
				toSend = makeOps.constructDestroy(circuitID);
			}

		}

		torSocket.write(toSend, function() {
			if(type === types.destroy && circuitID !== undefined) {
				//console.log("Destroying circuit " + circuitID + " on socket " + torSocket.getID());
				delete incomingRoutingTable[circuitID];
			}
		});
	}

}

module.exports = {
	TorRelayer : TorRelayer
};