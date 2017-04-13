// Handles the establishing part of a Tor socket, and responses.
// If another socket (or the proxy code) needs to send a Tor
// message out to another router, it should always do it through
// the sendMessage of a TorEstablisher, and when the response
// comes back, it'll be handled by whatever's registered as a
// responseHandler in that same TorEstablisher.

var constants = require('./helpers/Constants');
var readOps = require('./helpers/CellReadOperations');
var makeOps = require('./helpers/CellMakeOperations');

var types = constants.types;
var relayTypes = constants.relayTypes;
var MAX_ID = constants.glob.MAX_ID;

// Handles the creation and management of circuits that go out to another
// router through this socket.
function TorEstablisher(torSocket, isOpener) {
	var nextID = (isOpener) ? 1 : 2;

	// Which circuit number we should replace the existing circuit with
	// key(socketID, currentNum) -> newNum 
	var outgoingRoutingTable = {};

	// Functions to handle responses for each circuit that this socket
	// is in charge of
	// circuitID -> function
	var incomingRoutingTable = {};

	// circuitID -> timeout
	var timeoutTable = {};

	this.cleanup = function() {
		for(var key in incomingRoutingTable) {
			var deleteMessage = makeOps.constructDestroy(key);
			incomingRoutingTable[key]('ended', deleteMessage);
		}
	}

	this.isMyCircuit = function(circuitNum) {
		return((incomingRoutingTable[circuitNum]) ? true : false);
	};

	this.registerHandler = function(oldCircuitID, messagingSocketID, responseHandler) {
		var key = generateKey(oldCircuitID, messagingSocketID);

		// Housekeeping functions to piggyback onto the responseHandler
		// Mostly for removing entries in the routing table if we get
		// certain responses.
		var responseHousekeeping = function(status, message) {
			// if the message we're receiving back is of type destroy
			if(readOps.getType(message) === types.destroy || readOps.getType(message) === types.create_failed) {
				deleteCircuit(oldCircuitID, messagingSocketID);
				return "ended";
			}
			return status;
		}

		outgoingRoutingTable[key] = nextID;

		incomingRoutingTable[nextID] = function(status, message) {
			var newStatus = responseHousekeeping(status, message);
			responseHandler(newStatus, message);
		};

		nextID = (nextID + 2) % MAX_ID;
	};

	this.sendMessage = function(messagingSocketID, message) {
		// get the current circuit number. If we don't have an entry for that circuit and
		// the messaging socket id, fail. Otherwise, send the message (with new circuit number)
		// over the socket. Make entry in incomingRouting table between circuitNum and responseHandler
		// If no responseHandler is passed in, retain the current one. This is only really useful once
		// a circuit is set up and we want to reuse the handler for sending data back and forth

		var oldCircuitID = readOps.getCircuit(message);
		var newCircuitID = outgoingRoutingTable[generateKey(oldCircuitID, messagingSocketID)];

		var postWriteCallback;

		var messageType = readOps.getType(message);
		var relayType = readOps.getRelayCommand(message);
		var streamID = readOps.getStreamID(message);

		// This will only happen if there is an error in the TorRelayer code - issues in
		// other routers cannot directly cause this.
		if(isNaN(newCircuitID)) {
			return;
		}

		// Update the circuit id
		makeOps.modifyCircuitID(message, newCircuitID);

		// If we expect a response from this message
		// relay that isn't end or data
		// type that isn't relay or destroy
		if(messageType !== types.destroy && (messageType !== types.relay || relayType === relayTypes.extend)) {
			// If we're already waiting for a response on this circuit, print an error and return without sending
			// This will only occur if some code in 
			if(timeoutTable[newCircuitID]) {
				//console.log("ALREADY WAITING FOR RESPONSE ON CIRCUIT " + newCircuitID);
				var response = makeOps.constructMatchingFailure(messageType, newCircuitID, relayType, streamID);
				incomingRoutingTable[newCircuitID]('failure', response);
			}

			// After writing, set a timeout for receiving a response
			postWriteCallback = function() {
				timeoutTable[newCircuitID] = setTimeout(function() {
					// console.log("Timed out waiting for response, returning failure");
					// var type = readOps.getType(message);
					// var relayType = readOps.getRelayCommand(message);
					// var streamID = readOps.getStreamID(message);
					// var response = makeOps.constructMatchingFailure(type, newCircuitID, relayType, streamID);
					// incomingRoutingTable[newCircuitID]('failure', response);
					if(typeof(incomingRoutingTable[newCircuitID]) === 'function') {
						var deleteMessage = makeOps.constructDestroy(newCircuitID);
						incomingRoutingTable[newCircuitID]('ended', deleteMessage);
					}
				}, 5000);
			};
		}

		// If the message we're sending is of type destroy, delete the circuit
		// after passing along the message
		if(readOps.getType(message) === types.destroy) {
			postWriteCallback = function() {
				deleteCircuit(oldCircuitID, messagingSocketID);
			};
		}

		// Send the message
		torSocket.write(message);//, postWriteCallback);
		if(postWriteCallback) postWriteCallback();
		
	};

	this.handleResponse = function(message) {
		var circuitID = readOps.getCircuit(message);
		clearTimeout(timeoutTable[circuitID]);
		delete timeoutTable[circuitID];
		incomingRoutingTable[circuitID]('success', message);
	};

	// This is guaranteed to be unique since circuit ids can
	// only use two bytes.
	function generateKey(circuitID, socketID) {
		return (socketID << 16) + circuitID;
	}

	function deleteCircuit(oldCircuitID, messagingSocketID) {
		var oldKey = generateKey(oldCircuitID, messagingSocketID)
		var newID = outgoingRoutingTable[oldKey];
		if(newID !== undefined) {
			//console.log("Destroying circuit " + newID + " on socket " + torSocket.getID());
			delete outgoingRoutingTable[oldKey];
			delete incomingRoutingTable[newID];
			clearTimeout(timeoutTable[newID]);
			delete timeoutTable[newID];
		}
	}

}

module.exports = {
	TorEstablisher : TorEstablisher
};