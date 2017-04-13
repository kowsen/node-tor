var net = require('net');

var readline = require('readline');
var makeOps = require('../helpers/CellMakeOperations');

var server = require('./SocketServerTest');
var TorSocket = require('../TorSocket').TorSocket;
var TorConnector = require('../TorConnector').TorConnector;
var readOps = require('../helpers/CellReadOperations');

var packetString = require('../helpers/PacketPrinter').packetString;

var serverInfo = {
	host: 'localhost',
	port: 4444
};

var testSocket = net.createConnection(serverInfo, function() {
	var torSocket = new TorSocket(testSocket, 1);
	var torConnector = new TorConnector(torSocket, 0xAABBCCDD, function(status, establisher) {
		console.log("HANDSHAKE CALLED: " + status);

		establisher.registerHandler(1, 2, function(status, message) {
			console.log("RESPONSE RECEIVED WITH STATUS " + status);
			console.log(packetString(message));
			console.log("\n");
		});

		var create = makeOps.constructCreated(1);
		establisher.sendMessage(2, create);
		
	});
});

var rl = readline.createInterface(process.stdin, process.stdout);

rl.on('line', function(cmd) {
	cmd = cmd.split(' ');
	var message = "";
	if(cmd[0] === 'open') {
		message = makeOps.constructOpen(0xAABBCCDD, 0x11223344);
	} else if(cmd[0] === 'opened') {
		message = makeOps.constructOpened(0x11223344, 0xAABBCCDD);
	} else if(cmd[0] === 'fail') {
		message = makeOps.constructOpenFailed(0x11223344, 0xAABBCCDD);
	} else if(cmd[0] === 'created') {
		message = makeOps.constructCreated(parseInt(cmd[1]));
	} else if(cmd[0] === 'create_failed') {
		message = makeOps.constructCreateFailed(parseInt(cmd[1]));
	} else if(cmd[0] === 'destroy') {
		message = makeOps.constructDestroy(parseInt(cmd[1]));
	} else if(cmd[0] === 'gibberish') {
		message = makeOps.constructCreate(123);
	} else if(cmd[0] === 'multi_cell') {
		message = Buffer.concat([makeOps.constructOpen(0xAABBCCDD, 0x11223344), makeOps.constructOpen(0xAABBCCDD, 0x11223344)], 1024);
	} else if(cmd[0] === 'half_cell') {
		message = makeOps.constructOpen(0xAABBCCDD, 0x11223344);
		message = message.slice(0, 256);
	} else if(cmd[0] === 'long_relay') {
		for(var i = 0; i < 1024; i++) {
			message = message + 'a';
		}
		message = new Buffer(message);
		message[2] = 3;
		message[11] = 2;
		message[12] = 1;
	} else {
		console.log("COMMAND INVALID: " + cmd[0]);
	}
	server.messageOut(message);
});

server.registerReturnHandler(function(data) {
	console.log("DATA SENT FROM SOCKET");
	console.log(packetString(data));
	console.log("\n");
});