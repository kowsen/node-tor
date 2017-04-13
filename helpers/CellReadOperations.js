// Helper functions to easily read parts of cells

function getType(cell) {
	return getData(cell, 2, 3);
}

function getCircuit(cell) {
	return getData(cell, 0, 2);
}

function getOpenerAgent(cell) {
	return getData(cell, 3, 7);
}

function getOpenedAgent(cell) {
	return getData(cell, 7, 11);
}

function getStreamID(cell) {
	return getData(cell, 3, 5);
}

function getPadding(cell) {
	return getData(cell, 5, 7);
}

function getBodyLength(cell) {
	return getData(cell, 11, 13);
}

function getRelayCommand(cell) {
	return getData(cell, 13, 14);
}

function getBody(cell) {
	var length = getBodyLength(cell);
	return getData(cell, 14, 14 + length);
}

function getBodyString(cell) {
	var length = getBodyLength(cell);
	return getDataAsString(cell, 14, 14 + length);
}

function getBodyBuffer(cell) {
	var length = getBodyLength(cell);
	return cell.slice(14, 14 + length);
}

function getBeginHost(cell) {
	var hostString = getBodyString(cell);
	var hostSplit = hostString.split(":");
	return {
		host : hostSplit[0],
		port : parseInt(hostSplit[1])
	};
}

function getExtendHost(cell) {
	var hostString = getBodyString(cell);
	var hostSplit = hostString.slice(0, hostString.length - 4).split(":");
	return {
		host : hostSplit[0],
		port : parseInt(hostSplit[1])
	};
}

function getExtendAgent(cell) {
	var end = getBodyLength(cell) + 14;
	return getData(cell, end - 4, end);
}

function getDataAsString(cell, startByte, endByte) {
	return ((cell.slice(startByte, endByte)).toString());
}

function getData(cell, startByte, endByte) {
	var data = 0;
	for(var i = startByte; i < endByte; i++) {
		data *= 256;
		data += cell[i];
	}
	return data;
}

module.exports = {
	getType : getType,
	getCircuit : getCircuit,
	getOpenerAgent : getOpenerAgent,
	getOpenedAgent : getOpenedAgent,
	getStreamID : getStreamID,
	getPadding : getPadding,
	getBodyLength : getBodyLength,
	getRelayCommand : getRelayCommand,
	getBody : getBody,
	getBodyBuffer : getBodyBuffer,
	getBodyString : getBodyString,
	getBeginHost : getBeginHost,
	getExtendHost : getExtendHost,
	getExtendAgent : getExtendAgent
};