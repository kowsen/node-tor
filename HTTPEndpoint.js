// This is where relay calls where we're the endpoint are handled
// For example, an HTTP begin that requires us to open an HTTP socket
// or HTTP Data that needs to go to an open stream

var net = require('net');

// socketID, streamID -> HTTP socket
var streams = {};

// Open a connection to the passed in ip and port
function beginStream(socketID, circuitID, streamID, ip, port, respond) {
	var key = generateKey(socketID, circuitID, streamID);

	if(isNaN(port) || port < 0 || port > 65535) {
		respond('failed');
		return;
	}

	var socket = net.createConnection({host : ip, port : port}, function() {
		
		socket.on('error', endFailure);
		socket.on('close', endFailure);

		socket.removeListener('close', beginFailure);
		socket.removeListener('error', beginFailure);

		socket.on('data', forwardData);

		streams[key] = socket;

		respond('connected');

	});

	//console.log("BEGINNING STREAM");

	var beginFailure = function() {
		socket.end();
		// socket.removeListener('close', endFailure);
		// socket.removeListener('error', endFailure);
		respond('failed');
		delete streams[key];
	};

	var endFailure = function() {
		socket.end();
		// socket.removeListener('close', endFailure);
		// socket.removeListener('error', endFailure);
		respond('end');
		delete streams[key];
	};

	var forwardData = function(data) {
		respond('data', data);
	};

	socket.on('error', beginFailure);
	socket.on('close', beginFailure);
}

// Closes a connection with the server
function endStream(socketID, circuitID, streamID) {
	var key = generateKey(socketID, circuitID, streamID);
	var socket = streams[key];
	if(socket) {
		// socket.removeAllListeners('close');
		// socket.removeAllListeners('error');
		socket.end();
		delete streams[key];
	}
}

// Sends data to the server
function receiveData(socketID, circuitID, streamID, data) {
	var key = generateKey(socketID, circuitID, streamID);
	var socket = streams[key];
	if(socket) {
		socket.write(data);
	}
}

// This only allows for socket IDs to go up to 2^16
// before wrapping. If we get to the point where we have
// 2^16 active sockets at one time, I imagine everything else
// will already be on fire, so it'll probably be fine.
function generateKey(socketID, circuitID, streamID) {
	return (socketID << 32) + (circuitID << 16) + streamID;
}

// Closes all open sockets
function close() {
	for(var key in streams) {
		streaks[key].end();
	}
}

module.exports = {
	beginStream : beginStream,
	endStream : endStream,
	receiveData : receiveData,
	close : close
};