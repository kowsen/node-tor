// Wraps sockets connecting to other tor routers to give us an
// interface that "thinks" in tor messages. This will handle buffering
// incomplete messages, joining multi-cell messages, and preventing
// data loss if we haven't registered a data listener in time.

// As the project went along and deadlines approached, some of the
// other parts of the router ended up a little hacked together and
// iffy. I'm proud of this object - I think it's really solid and
// is a very useful abstraction.

var LOGGING = require("./helpers/Constants").glob.LOGGING;

var net = require('net');
var types = require('./helpers/Constants').types;
var relayTypes = require('./helpers/Constants').relayTypes;
var readOps = require('./helpers/CellReadOperations');

var packetString = require('./helpers/PacketPrinter').packetString;

isDebug = (LOGGING === '-t' || LOGGING === '-a');

// Abstracts the process of splitting TCP stream data into Tor cells
// We lose some of the functionality of the socket object, but we're
// unlikely to need anything that isn't already handled here, and the
// abstraction is worth it.
function TorSocket(socket, id) {

	// The listener to be called when new messages are available
	var dataListener = false;

	// If a TCP stream ends with a partial message, store it here
	// until we receive the rest
	var partialMessageBuffer;

	// The buffer of Tor messages ready to be handled by a dataListener
	var outputBuffer = [];

	// Either passes the event listener through to the raw socket -
	// for events like error, close, etc - or registers a dataListener
	// with this wrapper class for the data event
	this.on = function(event, handler) {
		if(event !== 'data') {
			//socket.on.apply(this, arguments);
			socket.on(event, handler);
		} else {
			dataListener = handler;
			// If we have any unsent data in the output buffer, send
			// it to the data listener.
			sendOutputBuffer();
		}
	};

	// Passes the call through to the socket for all events but data,
	// removes our dataListener if it's a data event
	this.removeListener = function(event, handler) {
		if(event !== 'data') {
			//socket.removeListener.apply(this, arguments);
			socket.removeListener(event, handler);
		} else {
			dataListener = false;
		}
	};

	// Passes write calls to the socket
	this.write = function(data, callback) {
		if(isDebug) {
			console.log(">>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>")
			console.log("Writing on Socket " + id + ":\n" + packetString(data, 100));
			console.log(">>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>\n")
		}
		socket.write(data, callback);
	};

	// Passes through close calls to the socket
	this.close = function(callback) {
		// delete allSockets[id];
		socket.end(callback);
	};

	// Setter for socket id
	this.setID = function(newID) {
		id = newID;
	};

	// Getter for socket id
	this.getID = function() {
		return id;
	};

	// Splits the incoming TCP stream, along with any partial cells we're currently buffering,
	// into tor messages, places them into the buffer, and calls the dataListener (if one exists)
	// to handle them.
	function processTCPData(data) {
		// If we're buffering a partial cell, prepend it to the incoming data
		if(partialMessageBuffer) {
			data = Buffer.concat([partialMessageBuffer, data], partialMessageBuffer.length + data.length);
		}

		// Counter. Declared outside so it can be used later
		var i;

		// For each complete cell in the chunk
		for(i = 0; i < data.length - 511; i += 512) {
			var cell = data.slice(i, i + 512);
			// if we have a multi-cell packet (checks for relay type first because
			// that's the only type that can be longer than 512 bytes)
			if(readOps.getType(cell) === types.relay && readOps.getBodyLength(cell) > (512 - 14)) {
				var end = roundUp(i + readOps.getBodyLength(cell) + 14, 512);
				// If the end of the packet is beyond our current data
				if(end > data.length) {
					// break and let the incomplete message handler take care of it
					break;
				}
				// otherwise, push the message
				var packet = data.slice(i, end);
				outputBuffer.push(packet);
				// prime i so incrementing will bring us to the next unread cell
				i = end - 512;
			} else {
				// otherwise, just push the cell
				var packet = data.slice(i, i + 512)
				outputBuffer.push(packet);
			}
		}

		// If we have an incomplete cell at the end, replace the partial cell buffer
		if(i < data.length) {
			partialMessageBuffer = data.slice(i, data.length);
		} else {
			// Otherwise, just clear it
			partialMessageBuffer = false;
		}

		// If we have a registered data listener, send it all the cells in the output buffer
		sendOutputBuffer();

	}

	// Sends our output buffer to dataListener and clears it
	// If we don't have a registered dataListener, break the loop and maintain
	// the buffer. The check is inside the loop in case the code in dataListener
	// removes the dataListener, in which case we would want to maintain the buffer
	function sendOutputBuffer() {
		while(outputBuffer.length > 0) {
			if(!dataListener) {
				break;
			}
			var nextPacket = outputBuffer.shift();
			if(isDebug) {
				console.log("<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<");
				console.log("Received on Socket " + id + ":\n" + packetString(nextPacket, 100));
				console.log("<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<<\n");
			}
			dataListener(nextPacket);
		}
	}

	// Can't believe JS doesn't have this built in.
	function roundUp(val, step) {
		return step * Math.ceil(val / step);
	}

	socket.on('error', function() {
		//console.log("ERROR IN SOCKET");
	});

	socket.on('timeout', function() {
		//console.log("ERROR IN SOCKET");
	});

	// Set our listener for the raw socket
	socket.on('data', processTCPData);

}

module.exports = {
	TorSocket : TorSocket
};