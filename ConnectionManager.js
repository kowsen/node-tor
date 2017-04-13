// Handles listening for and creating new connections to
// Tor routers where we are the openee, and provides
// an abstraction to the rest of the app to retrieve a
// connection with another agent. Makes it transparent
// whether we open a new TCP connection to the other agent
// or use an existing one.

var net = require('net');
var glob = require('./helpers/Constants').glob;

var TorSocket = require('./TorSocket').TorSocket;
var TorConnector = require('./TorConnector').TorConnector;
var routers = require('./RouterManager');

var TOR_PORT = glob.TOR_PORT;
var MAX_ID = glob.MAX_ID;

// socket ID 0 and 1 are reserved for HTTP connection managers
var nextSocketID = 2;

var torServer = net.createServer(function(socket) {
	var torSocket = new TorSocket(socket, nextSocketID);
	nextSocketID = (nextSocketID + 1) % MAX_ID;
	new TorConnector(torSocket, false, routers.registerConnection);
});

torServer.listen(TOR_PORT, function(err) {
	if(err) throw err;
	console.log("Tor server listening on port " + torServer.address().port);
});

torServer.on('error', function() {
	console.log("TorServer error");
});

glob.TOR_IP = torServer.address().address;

// Called when a TorSocket connection wrapper wants to relay data to a connection
// it does not already have a circuit set up with.
// Either gets a saved TCP port if we already have a connection,
// or creates a new one.
function getConnection(agent, connectionInfo, responseHandler) {

	var failTimeout;

	var failResponse = function() {
		clearTimeout(failTimeout);
		agentSocket.end();
		//agentSocket.removeListener('error', failResponse);
		//agentSocket.removeListener('close', failResponse);
		responseHandler('failure');
	};

	// if we already have an open TorSocket to the agent
	if(routers.isExistingConnection(agent)) {
		responseHandler('success', routers.isExistingConnection(agent));
	} else {
		var port = connectionInfo.port;
		if(isNaN(port) || port < 0 || port > 65535) {
			responseHandler('failure');
			return;
		}
		failTimeout = setTimeout(failResponse, 3000);
		var agentSocket = net.createConnection(connectionInfo, function() {
			clearTimeout(failTimeout);
			var torSocket = new TorSocket(agentSocket, nextSocketID);
			nextSocketID = (nextSocketID + 1) % MAX_ID;
			new TorConnector(torSocket, agent, function(status, establisher, agent) {
				if(status === 'success') {
					routers.registerConnection('success', establisher, agent);
					responseHandler('success', establisher);
				} else {
					// handshake was not accepted by agent, call responseHandler with error
					responseHandler('failure');
				}
				agentSocket.removeListener('error', failResponse);
				agentSocket.removeListener('close', failResponse);
			});
		});
		agentSocket.on('error', failResponse);
		agentSocket.on('close', failResponse);
		agentSocket.on('timeout', function() {
			//console.log("TIMEOUT");
		});
	}
}

module.exports = {
	getConnection : getConnection
}