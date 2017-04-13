// Helper functions to validate the consistency,
// type, and contents of cells

var readOps = require('./CellReadOperations');
var constants = require('./Constants');

var types = constants.types;
var relayTypes = constants.relayTypes;

function validateOpen(cell, openerAgent, openedAgent) {
	return validateOpenHelper(cell, openerAgent, openedAgent, types.open);
}

function validateOpened(cell, openerAgent, openedAgent) {
	return validateOpenHelper(cell, openerAgent, openedAgent, types.opened);
}

function validateCreated(cell, circuitID) {
	return validateCreateHelper(cell, circuitID, types.created);
}

function validateRelayConnected(cell, circuitID, streamID) {
	return validateRelayHelper(cell, circuitID, streamID, relayTypes.connected);
}

function validateRelayExtended(cell, circuitID, streamID) {
	return validateRelayHelper(cell, circuitID, streamID, relayTypes.extended);
}

function validateOpenHelper(cell, openerAgent, openedAgent, type) {
	return cell.length === 512
		&& readOps.getType(cell) === type
		&& readOps.getOpenerAgent(cell) === openerAgent
		&& readOps.getOpenedAgent(cell) === openedAgent;
}

function validateCreateHelper(cell, circuitID, type) {
	return cell.length === 512
		&& readOps.getType(cell) === type
		&& readOps.getCircuit(cell) === circuitID;
}

function validateRelayHelper(cell, circuitID, streamID, type) {
	return (cell.length % 512) === 0
		&& readOps.getType(cell) === types.relay
		&& readOps.getCircuit(cell) === circuitID
		&& readOps.getStreamId(cell) === streamID
		&& readOps.getPadding(cell) === 0
		&& readOps.getBodyLength(cell) === 0
		&& readOps.getRelayCommand(cell) === type;
}

module.exports = {
	validateOpen : validateOpen,
	validateOpened : validateOpened,
	validateCreated : validateCreated,
	validateRelayConnected : validateRelayConnected,
	validateRelayExtended : validateRelayExtended,
};