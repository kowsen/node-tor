// Manages our record of the other routers, and provides abstractions
// to the rest of the router to retrieve random routers or to check
// if we're already connected to an agent.

var glob = require('./helpers/Constants').glob;
var registration = require('./registration/Registration');

var TOR_PORT = glob.TOR_PORT;
var MY_AGENT = glob.MY_AGENT;
var MY_GROUP = glob.MY_GROUP;
var MY_INSTANCE = glob.MY_INSTANCE;
var IS_ONLY_MINE = glob.IS_ONLY_MINE;

// array of available tor routers
var availableRouters = [];

// map from agent to establisher for ports function
var existingConnections = {};

// Used to delay other parts of the router until
// we 
var initialFetchCompleted = false;
var initialCallback;

function getRandomRouter(invalidList) {

	var usefulRouters;

	// If we're passed in an invalid list, only consider entries not in invalidList
	if(invalidList && invalidList.length > 0) {
		usefulRouters = availableRouters.filter(function(val) {
			return invalidList.indexOf(val) === -1;
		});
	} else {
		usefulRouters = availableRouters;
	}

	// Return connection information for this router if we don't have record of any
	// other routers. This should only happen if we're the only other router, if all
	// other routers are in the invalid list, or if we can't access the registration
	// service.
	if(usefulRouters.length === 0) {
		console.log("No routers available, returning self");
		return {
			connectInfo : {
				host : glob.TOR_IP,
				ip : glob.TOR_IP,
				port : TOR_PORT
			},
			agent : MY_AGENT
		}
	}

	// Otherwise, just return a random router
	var randomVal = Math.random() * usefulRouters.length;
	var index = Math.floor(randomVal);
	return usefulRouters[index];
}

function isExistingConnection(agent) {
	return (existingConnections[agent]) ? existingConnections[agent] : false;
}

// Called when a new socket is created with us as the openee
function registerConnection(status, establisher, agent) {
	if(establisher) {
		existingConnections[agent] = establisher;
	}
}

function removeConnection(agent) {
	delete existingConnections[agent];
}

function setInitialCallback(func) {
	if(initialFetchCompleted) {
		func();
	} else {
		initialCallback = func;
	}
}

function padZero(num, digits) {
	return String('00000000'+num.toString(16)).slice(-digits);
}

// Nicely prints all the routers we have access to
function printRouters(data) {
	console.log("Available Routers:");
	for(var i = 0; i < data.length; i++) {
		var router = data[i];
		var team = "0x" + padZero(router.agent >> 16, 4);
		var id = "0x" + padZero(router.agent & 0xFFFF, 4);
		console.log("\tTeam: " + team + ", ID: " + id + ", IP: " + router.connectInfo.ip + ", Port: " + router.connectInfo.port);
	}
}

// Register this router on the network
var group = padZero(MY_GROUP, 4);
var instance = padZero(MY_INSTANCE, 4);

// Counts up so we can exit if we fail to reach the registration
// server three times.
var failCounter = 0;

// If the IS_ONLY_MINE argument is truthy, only look for routers
// with my group number. By default, look for all routers.
var routerString = IS_ONLY_MINE ? ("Tor61Router-" + group) : "Tor61Router-";

// Run initial fetch of routers
function initialFetch() {
	registration.register(TOR_PORT, MY_AGENT, "Tor61Router-" + group + "-" + instance, function(status) {
		if(status) {
			// Update our list of available routers every 5 minutes
			var setRouters = function(data) {
				if(data) {
					// Strip this router from the list of available routers
					// This means we'll only connect with a self loop if we
					// fail to connect to all other routers. This isn't part
					// of the spec, but I feel like it's more in the spirit
					// of tor to treat self-loops as something to avoid.
					var newData = [];
					for(var i = 0; i < data.length; i++) {
						if(data[i].agent !== MY_AGENT) {
							newData.push(data[i]);
						}
					}
					availableRouters = newData;
				} else {
					console.log("Unable to reach registration service");
				}
				setTimeout(function() {
					registration.fetch(routerString, setRouters);
				}, 5 * 60 * 1000);
			}
			registration.fetch(routerString, function(data) {
				printRouters(data);
				console.log();
				setRouters(data);
				initialFetchCompleted = true;
				if(typeof(initialCallback) === 'function') {
					initialCallback();
				}
			});
		} else {
			console.log("Unable to reach registration service for initial fetch. Retrying...");
			failCounter++;
			if(failCounter >= 3) {
				process.exit();
			}
			initialFetch();
		}
	});
}

initialFetch();

module.exports = {
	getRandomRouter : getRandomRouter,
	isExistingConnection : isExistingConnection,
	registerConnection : registerConnection,
	removeConnection : removeConnection,
	setInitialCallback : setInitialCallback
};