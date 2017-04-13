// The proxy object. This is largely unchanged from the project2
// code. The only differences are that it gives each request a
// unique StreamID, and it uses an HTTPStream instead of a direct
// connection to the server. Since the HTTPStream has a near-identical
// interface, these represent small code changes.

var glob = require("../helpers/Constants").glob;
var net = require('net');
var HTTPStream = require('../CircuitCreator').HTTPStream;

var isDebug = (glob.LOGGING === '-a' || glob.LOGGING === '-h');

function printDebug(message) {
	if(isDebug) {
		if(message) {
			console.log(message);
		} else {
			console.log();
		}
	}
}

// --------------------------------------
// 	Set up server to listen for connections
// --------------------------------------

var sessions = {};

var serverPort = glob.SERVER_PORT;

var server = net.createServer(function(socket) {
	new RequestHandler(socket);
});

server.on('error', function(err) {
	console.log(err);
});

server.listen(serverPort, function(err) {
	if(err) throw err;
	address = server.address();
	console.log("Proxy listening on port " + address.port);
});

// --------------------------------------
// 	Handles a single request / session
// --------------------------------------

var nextStreamID = 0;

var RequestHandler = function(socket) {

	// Store session so it can be cleanly destroyed on close
	sessions[streamID] = socket;

	var streamID = nextStreamID;
	nextStreamID = (nextStreamID + 1) % glob.MAX_ID;

	// The "serverSocket" in this case is actually just an interface into the
	// Tor section of the router that resembles a net socket interface
	// This allowed me to reuse most of the proxy code with very little modification.
	var serverSocket;

	// Temporary storage for buffering the data
	var prevData;

	socket.on('error', function() {
		endConnection();
	});

	socket.on('data', handleInitialMessage);

	// Handles the initial message
	function handleInitialMessage(data) {

		// if we are in the middle of buffering a header
		if(prevData) {
			// add this data to the end of our header buffer
			data = Buffer.concat([prevData, data], prevData.length + data.length);
		}

		// Gets our header string if we have the entire header buffered, or false if not
		var header = getHeaderString(data);

		// If we have yet to receive the entire header
		if(!header) {
			// Get our buffer ready for the next packet
			prevData = data;
			return;
		}

		// When we have the entire header, no longer call this function when getting new data
		socket.removeListener('data', handleInitialMessage);

		var method = getMethod(header);
		var serverInfo = getHostname(header);
		
		printDebug(">>> " + header.split("\r\n")[0]);

		if(method === 'CONNECT') {
			handleConnectTunnel(serverInfo);
		} else {
			handleNormalRequest(serverInfo, data);
		}
	}

	// Handles setting up a tunnel to the given server
	function handleConnectTunnel(serverInfo) {
		// The only major difference from the proxy project is that we create an HTTPStream instead
		// of a direct socket to the web server
		serverSocket = new HTTPStream(streamID, serverInfo.host, serverInfo.port, function() {

			socket.on('close', endConnection);
			socket.on('error', endConnection);

			serverSocket.removeListener('close');
			serverSocket.on('close', function() {
				endConnection();
			});

			// Connect the two sockets
			serverSocket.on('data', function(data) {
				socket.write(data);
			});

			socket.on('data', function(data) {
				serverSocket.write(data);
			});

			// Let the browser know the connection is set up
			socket.write("HTTP/1.1 200 OK\r\n\r\n");

		});

		// If we can't make a connection, let the browser know
		serverSocket.on('close', function() {
			if(socket.readyState !== 3) {
				socket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
			}
			endConnection();
		});
	}

	// Handles communicating the given HTTP request to the given server
	// initialData contains the entire request header, and whatever data
	// came in on the same packet as the last of the header data
	function handleNormalRequest(serverInfo, initialData) {
		serverSocket = new HTTPStream(streamID, serverInfo.host, serverInfo.port, function() {

			socket.on('close', endConnection);
			socket.on('error', endConnection);

			// buffer for return header
			var prevData;

			// Handles the return header
			var handleReturnHeader = function(data) {
				// if we are in the middle of buffering a header
				if(prevData) {
					// add this data to the end of our header buffer
					data = Buffer.concat([prevData, data], prevData.length + data.length);
				}

				// Gets our header string if we have the entire header buffered, or false if not
				var header = getHeaderString(data);

				// If we have yet to receive the entire header
				if(!header) {
					// Get our buffer ready for the next packet
					prevData = data;
					return;
				}

				// If we have the entire header, no longer call this function on getting data
				serverSocket.removeListener('data', handleReturnHeader);

				// pipe all data from the server to the browser
				serverSocket.on('data', function(data) {
					socket.write(data);
				});

				// Send the modified header plus whatever data is buffered (if any)
				// to the browser.
				socket.write(constructPacket(data));
			};

			// Set up initial handler for server data
			serverSocket.on('data', handleReturnHeader);

			// pipe all data from the browser to the server
			socket.on('data', function(data) {
				serverSocket.write(data);
			});

			// Send the modified header plus whatever data is buffered (if any)
			// to the browser.
			serverSocket.write(constructPacket(initialData));
		});

		// If we can't connect to the server, print an error message and close the request.
		serverSocket.on('close', function() {
			// There's no really nice way to tell why we got a begin_failed message back on
			// Tor, so we don't have enough information to print a descriptive error. Thus,
			// we just kill the connection.
			endConnection();
		});
	}

	function constructPacket(data) {
		var header = getHeaderString(data);
		var newHeader = formatHeader(header);
		// Add \r\n\r\n to denote the end of the header
		var headerBuf = new Buffer(newHeader + "\r\n\r\n");
		// Represents any data that was buffered at the end of the header
		var payload = data.slice(header.length + 4);
		return Buffer.concat([headerBuf, payload]);
	}

	function getHeaderString(data) {
		var splitString = data.toString().split("\r\n\r\n");
		// if we don't have the full header
		if(splitString.length === 1) {
			return false;
		} else {
			return data.toString().split("\r\n\r\n")[0];
		}
	}

	// Get the method being used in the request
	function getMethod(headerString) {
		var splitHeader = headerString.split("\r\n");
		var message = splitHeader[0].split(" ")[0];
		return message;
	}

	// Get the host and port we are connecting to
	function getHostname(headerString) {
		var splitHeader = headerString.split("\r\n");

		var hostLine = '';
		var port = '';

		// Split url by colons
		var urlSplit = splitHeader[0].split(" ")[1].split(":");
		// If we have two or more colons, check if the last token is a port number
		if(urlSplit.length >= 3 && !isNaN(urlSplit[urlSplit.length - 1])) {
			port = urlSplit[2];
		// If not, check if we have an https address
		} else if(urlSplit[0] === "https") {
			port = "443";
		// Default to port 80.
		} else {
			port = "80";
		}
		// For each line in the header
		for(var i = 1; i < splitHeader.length; i++) {
			// If this is the host line
			if(splitHeader[i].slice(0,5) === 'Host:') {
				// split by colon
				var hostLineSplit = splitHeader[i].slice(6).split(":");
				// If our host line has a port at the end
				if(hostLineSplit.length === 2 && !isNaN(hostLineSplit[1])) {
					port = hostLineSplit[1];
				}
				hostLine = hostLineSplit[0];
				break;
			}
		}
		return {host: hostLine, port: parseInt(port)};
	}

	function formatHeader(headerString) {
		// split header by line
		var splitHeader = headerString.split("\r\n");

		// Should match any string formatted as "HTTP/#.#"
		var anyHTTP = new RegExp('HTTP/.\..');
		// Replace with HTTP/1.0
		splitHeader[0] = splitHeader[0].replace(anyHTTP, 'HTTP/1.0');

		// For each line in the header
		for(var i = 1; i < splitHeader.length; i++) {
			if(splitHeader[i] === "Connection: keep-alive") {
				splitHeader[i] = "Connection: close";
			}
			if(splitHeader[i] === "Proxy-Connection: keep-alive") {
				splitHeader[i] = "Proxy-Connection: close";
			}
		}
		return splitHeader.join("\r\n");
	}

	// Unpipe our connections if they are piped, and end both.
	function endConnection() {
		socket.end();
		if(serverSocket) {
			serverSocket.end();
		}
		delete sessions[streamID];
	}

};

// Destroy all sessions and close the server
function close() {
	for(var key in sessions) {
		sessions[key].end();
	}
	server.close();
}

module.exports = {
	close : close
};