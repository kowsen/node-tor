var net = require('net');

var readOps = require('../helpers/CellReadOperations');
var makeOps = require('../helpers/CellMakeOperations');
var packetString = require('../helpers/PacketPrinter').packetString;

var torAgent = 0x4550379;

var agent1 = 1;
var agent2 = 2;

var torInfo = {
	host : 'localhost',
	port : 4567
};

function setUpSock1(otherPort) {
	var sock1 = net.createConnection(torInfo, function() {
		console.log("CREATED SOCKET 1");
		var open = makeOps.constructOpen(agent1, torAgent);
		sock1.on('data', respondToOpened);
		sock1.write(open);
	});

	var respondToOpened = function() {
		console.log("RECEIVED OPEN - S1");
		sock1.removeListener('data', respondToOpened);
		sock1.on('data', respondToCreated);
		var create = makeOps.constructCreate(1);
		sock1.write(create);
	};

	var respondToCreated = function() {
		console.log("RECEIVED CREATED - S1");
		sock1.removeListener('data', respondToCreated);
		sock1.on('data', function(data) {
			console.log("\nReceived on socket 1:");
			console.log(packetString(data));
		});
		var agentBuffer = new Buffer(4);
		agentBuffer[0] = 0x04;
		agentBuffer[1] = 0x55;
		agentBuffer[2] = 0x00;
		agentBuffer[3] = 0x65;
		var extend = makeOps.constructRelayExtend(1, 0, 'localhost:' + 4448 + agentBuffer.toString());
		sock1.write(extend);
		console.log("WROTE EXTEND - S1");
	}
}

var sock2 = net.createConnection(torInfo, function() {
	console.log("CREATED SOCKET 2");
	var open = makeOps.constructOpen(agent2, torAgent);
	sock2.on('data', respondToOpened2);
	sock2.write(open);
});

var respondToOpened2 = function() {
	console.log("RECEIVED OPENED - S2");
	sock2.removeListener('data', respondToOpened2);
	sock2.on('data', function(data) {
		console.log("\nReceived on socket 2:");
		console.log(packetString(data));
		var circuitID = readOps.getCircuit(data);
		var created = makeOps.constructCreated(circuitID);
		sock2.write(created);
	});
	setUpSock1(sock2.address().port);
}