var net = require('net');

var serverPort = 4444;

var sock;
var handler;

var server = net.createServer(function(socket) {
	console.log("CONNECTED");
	sock = socket;
	if(handler) {
		sock.on('data', handler);
	}
});

server.on('error', function(err) {
	console.log(err);
});

server.listen(serverPort, function(err) {
	if(err) throw err;
	address = server.address();
	console.log("Proxy listening on " + address.address + ":" + address.port);
});

function messageOut(data) {
	sock.write(data);
}

function registerReturnHandler(func) {
	handler = func;
	if(sock) {
		sock.on('data', func);
	}
}

module.exports = {
	messageOut : messageOut,
	registerReturnHandler : registerReturnHandler
};