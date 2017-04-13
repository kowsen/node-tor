var glob = require("./helpers/Constants").glob;

glob.SERVER_PORT = parseInt(process.argv[2]);
glob.TOR_PORT = parseInt(process.argv[3]);
glob.MY_GROUP = parseInt(process.argv[4], 16);
glob.MY_INSTANCE = parseInt(process.argv[5], 16);
glob.LOGGING = process.argv[6];
glob.MY_AGENT = (glob.MY_GROUP << 16) + glob.MY_INSTANCE;
glob.IS_ONLY_MINE = process.argv[7];

require("./RouterManager");
require("./ConnectionManager");
var creatorClose = require("./CircuitCreator").close;
var proxyClose = require("./proxy/proxy").close;
var httpClose = require('./HTTPEndpoint').close;

process.on('SIGINT', function() {
	console.log("Cleaning up Tor connections");
	creatorClose();
	console.log("Cleaning up web connections");
	httpClose();
	console.log("Cleaning up browser connections");
	proxyClose();
	console.log("Sockets closed - exiting");
	process.exit();
});