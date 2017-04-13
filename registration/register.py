import socket
import sys
import threading
import math
import time


##################################
# Arguments
##################################

serverHost = sys.argv[1]
serverPort = int(sys.argv[2])


##################################
# External IP Address
##################################

# On a lot of machines, we could get this through
# socket.gethostbyname, but that doesn't work on Ubuntu
# and some other distros, so went with a more portable -
# albiet clunky - solution.
ipGetSocket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
ipGetSocket.connect(('8.8.8.8', 80))

machineIP = ipGetSocket.getsockname()[0]

ipGetSocket.close()


##################################
# Set up send socket
##################################

sendSock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sendSock.bind(('', 0))
sendSock.settimeout(3.0)


##################################
# Helpful constants
##################################

MAGIC_NUM = 0xC461
CMD_REGISTER = 0x01
CMD_REGISTERED = 0x02
CMD_FETCH = 0x03
CMD_FETCHRESPONSE = 0x04
CMD_UNREGISTER = 0x05
CMD_PROBE = 0x06
CMD_ACK = 0x07


##################################
# Fields
##################################

sequence = 0
sessions = {}


##################################
# Utility Functions
##################################

# Constructs a hex string representing the number, and pads
# it with 0s to be at least the passed in digits long
def numToHex(number, digits = 0):
	return format(number, 'x').rjust(digits,'0')

# Converts an ip in "0.0.0.0" format into an
# integer representing that address
def ipStrToNum(ip):
	splitIP = map(int, ip.split('.'))
	ipVal = 0
	for index in range(0, 4):
		ipVal += splitIP[index] * int(math.pow(256, 3 - index))
	return ipVal

# Converts an IP Address in integer form to the
# "0.0.0.0" string form
def ipNumToStr(ip):
	ipStr = str(ip >> 24)
	for index in range(1, 4):
		ipStr = ipStr + "." + str((ip >> (3 - index) * 8) & 0xFF)
	return ipStr

def printFlush(data):
	print data
	sys.stdout.flush()


##################################
# Packet Class
##################################

# Represents a packet of data
class Packet:
	def __init__(self):
		self.data = ""

	def constructSendHeader(self, command):
		self.pushVal(MAGIC_NUM, 2)
		self.pushVal(sequence, 1)
		self.pushVal(command, 1)

	def pushVal(self, data, bytes):
		self.data = self.data + numToHex(data, bytes * 2)

	def pushStr(self, data):
		self.data = self.data + data.encode('hex')

	def pushIntArr(self, data):
		for index in range(0, len(data)):
			self.pushVal(data[index], 1)

	def refreshHeader(self):
		frontData = self.data[0:4]
		endData = self.data[6:]
		self.data = frontData + numToHex(sequence, 2) + endData

	def getSendPacket(self):
		return bytearray.fromhex(self.data)

	def getVal(self, low, high = None):
		if high is None:
			high = low + 1
		intRep = int(self.data, 16)
		intRep = intRep >> ((len(self.data) / 2 - high) * 8)
		return int(intRep & int(math.pow(2, (high - low) * 8) - 1))


##################################
# Message Sending
##################################

def register(servicePort, data, serviceName):
	def responseHandler(response, sent):
		if response.getVal(3) != CMD_REGISTERED:
			printFlush("<<Invalid type, expected Registered")
		else:
			sessions[servicePort] = (sent, time.time() + (response.getVal(4, 6) - 1))
			printFlush("register_success")

	packet = Packet()
	packet.constructSendHeader(CMD_REGISTER)
	packet.pushVal(ipStrToNum(machineIP), 4)
	packet.pushVal(int(servicePort), 2)
	packet.pushVal(int(data), 4)
	packet.pushVal(len(serviceName), 1)
	packet.pushStr(serviceName)

	sendMessage(packet, "REGISTER", responseHandler)


def unregister(servicePort):
	def responseHandler(response, sent):
		if response.getVal(3) != CMD_ACK:
			printFlush("<<Invalid response, expected ACK")
		else:
			sessions.pop(servicePort, None)
			printFlush("unregister_success")

	packet = Packet()
	packet.constructSendHeader(CMD_UNREGISTER)
	packet.pushVal(ipStrToNum(machineIP), 4)
	packet.pushVal(int(servicePort), 2)

	sendMessage(packet, "UNREGISTER", responseHandler)


def fetch(serviceName = ''):
	def responseHandler(response, sent):
		if response.getVal(3) != CMD_FETCHRESPONSE:
			printFlush("<<Invalid response, expected fetch response")
		elif response.getVal(4) == 0:
			printFlush("fetch_end")
		else:
			# Print all entries
			for entry in range(0, response.getVal(4)):
				start = 5 + (entry * 10)
				ipStr = ipNumToStr(response.getVal(start, start + 4))
				servPort = response.getVal(start + 4, start + 6)
				servData = response.getVal(start + 6, start + 10)
				printFlush("fetch_entry\t" + ipStr + "\t" + str(servPort) + "\t" + str(servData))
			printFlush("fetch_end")

	packet = Packet()
	packet.constructSendHeader(CMD_FETCH)
	packet.pushVal(len(serviceName), 1)
	packet.pushStr(serviceName)

	sendMessage(packet, "FETCH", responseHandler)


def probe():
	def responseHandler(response, sent):
		if response.getVal(3) != CMD_ACK:
			printFlush("<<Invalid response, expected ACK")
		else:
			printFlush("<<Probe response received")

	packet = Packet()
	packet.constructSendHeader(CMD_PROBE)

	response = sendMessage(packet, "PROBE", responseHandler)


# Helper function for all message sending functions, puts the data together,
# sends it, and calls the responseHandler with the response from the server
# if one is received, and it passes universal validity checks.
def sendMessage(packet, typeName, responseHandler):
	global sequence

	sendSock.sendto(packet.getSendPacket(), (serverHost, serverPort))
	
	# Listen for response
	attempts = 0
	while True:
		try:
			data, addr = sendSock.recvfrom(1024)
			break
		except socket.timeout:
			attempts = attempts + 1
			printFlush("<<Timed out waiting for reply to " + typeName + " message")
			if attempts > 2:
				printFlush("timed_out")
				return

	# Increment sequence
	sequence = (sequence + 1) % 256

	# Format response into a packet
	respPacket = Packet()
	respPacket.pushIntArr(map(ord, data))

	# Sanity checks on packet before calling handler
	if respPacket.getVal(0, 2) != MAGIC_NUM:
	 	printFlush("<<Magic number invalid")
	 	return
	if respPacket.getVal(2) != ((256 + sequence - 1) % 256):
	 	printFlush("<<Wrong sequence - expected " + str(sequence) + ", got " + str(respPacket.getVal(2)))
	 	return

	# Pass packet to handler
	responseHandler(respPacket, packet)

def unknownCommand(*arg):
	printFlush("<<Unknown Command, please try again")


##################################
# Probe Handling Thread
##################################

# Listens for probes from the server, and responds if
# the probe is valid.
def listenLoop():
	recvSock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
	recvSock.bind(('', sendSock.getsockname()[1] + 1))
	printFlush("<<SETTING UP LISTEN LOOP ON PORT " + str(sendSock.getsockname()[1] + 1))
	while True:
		data, addr = recvSock.recvfrom(1024)
		printFlush("<<RECEIVED PACKET FROM LISTEN LOOP")
		packet = Packet()
		packet.pushIntArr(map(ord, data))
		magic = packet.getVal(0, 2)
		seq = packet.getVal(2, 3)
		cmd = packet.getVal(3, 4)

		if (magic == MAGIC_NUM) & (cmd == CMD_PROBE):
			printFlush(">>Registration service probed.")

			response = Packet()
			response.pushVal(MAGIC_NUM, 2)
			response.pushVal(seq, 1)
			response.pushVal(CMD_ACK, 1)

			recvSock.sendto(response.getSendPacket(), addr)

listenThread = threading.Thread(target=listenLoop)
listenThread.daemon = True
listenThread.start()

def reRegisterLoop():
	while True:
		ports = sessions.keys()
		for port in ports:
			packetInfo = sessions.get(port, None)
			if(packetInfo is None):
				continue
			if(time.time() > packetInfo[1]):

				sessions.pop(port, None)

				def responseHandler(response, sent):
					if response.getVal(3) != CMD_REGISTERED:
						printFlush("<<Invalid type on re-register, expected Registered")
					else:
						sessions[port] = (sent, time.time() + response.getVal(4, 6) - 1)
						printFlush(">>Re-register on registration service successful")

				packetInfo[0].refreshHeader()
				sendMessage(packetInfo[0], "REGISTER", responseHandler)
timeoutThread = threading.Thread(target=reRegisterLoop)
timeoutThread.daemon = True
timeoutThread.start()


##################################
# Input loop
##################################

# Gives the input loop an easier way to
# call the message sending functions
dispatcher = {
	'r' : register,
	'u' : unregister,
	'f' : fetch,
	'p' : probe,
	'q' : sys.exit
}

printFlush("<<regServerIP = " + socket.gethostbyname(serverHost))
printFlush("<<thisHostIP = " + machineIP)

# Listens for input
while True:
	try:
		inputStr = raw_input()
		args = inputStr.split();
		if len(args) == 0:
			continue
		dispatcher.get(args[0], unknownCommand)(*(args[1:]))
	# Ctrl+C or Ctrl+D
	except (EOFError, KeyboardInterrupt):
		printFlush("<<Cleaning up browser connections");
		ports = sessions.keys()
		for port in ports:
			unregister(port)
		break
	# Incorrect number of arguments
	except (TypeError):
		printFlush("<<Incorrect number of arguments for " + args[0])
