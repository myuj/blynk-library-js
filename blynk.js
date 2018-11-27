/* Copyright (c) 2015 Volodymyr Shymanskyy. See the file LICENSE for copying permission. */

'use strict';

var C = {
};

/*
 * Helpers
 */
function string_of_enum(e,value) 
{
  for (var k in e) if (e[k] == value) return k;
  return "Unknown(" + value + ")";
}

function isEspruino() {
  if (typeof process === 'undefined') return false;
  if (typeof process.env.BOARD === 'undefined') return false;
  return true;
}

function isNode() {
  return !isEspruino() && (typeof module !== 'undefined' && ('exports' in module));
}

function isBrowser() {
  return (typeof window !== 'undefined');
}

function needsEmitter() {
  return isNode();
}

// This is replaced to support utf-8 in node.js env.
function ab2str(buf) {
  return String.fromCharCode.apply(null, new Uint8Array(buf));
}

// This is replaced to support utf-8 in node.js env.
function str2ab(str) {
  var buf = new ArrayBuffer(str.length); // 2 bytes for each char
  var bufView = new Uint8Array(buf);
  for (var i=0, strLen=str.length; i < strLen; i++) {
    bufView[i] = str.charCodeAt(i);
  }
  return buf;
}

function decodeValues(buf) {
  var values = [];
  var index = 0;
  while ((index = new Uint8Array(buf).indexOf(0)) !== -1) {
    values.push(buf.slice(0, index));
    buf = buf.slice(index + 1);
}
  values.push(buf);
  return values.map(ab2str);
}

function encodeValues(values) {
  var buf = new ArrayBuffer();;
  values.forEach(function (v) {
    if (buf.byteLength !== 0) {
      buf = mergeBuffer(buf, new Uint8Array([0]).buffer);
    }
    buf = mergeBuffer(buf, str2ab('' + v));
  });
  return buf;
}

function mergeBuffer(buf1, buf2) {
  if(buf1.byteLength === 0){
    return buf2;
  }
  if(buf2.byteLength === 0){
    return buf1;
  }
  var tmp = new Uint8Array(buf1.byteLength + buf2.byteLength);
  tmp.set(new Uint8Array(buf1), 0);
  tmp.set(new Uint8Array(buf2), buf1.byteLength);
  return tmp.buffer;
}

function blynkHeader(msg_type, msg_id, msg_len) {
  return new Uint8Array([
    msg_type,
    msg_id >> 8, msg_id & 0xFF,
    msg_len >> 8, msg_len & 0xFF
  ]).buffer;
}

var MsgType = {
  RSP           :  0,
  REGISTER      :  1, //"mail pass"
  LOGIN         :  2, //"token" or "mail pass"
  SAVE_PROF     :  3,
  LOAD_PROF     :  4,
  GET_TOKEN     :  5,
  PING          :  6,
  ACTIVATE      :  7, //"DASH_ID"
  DEACTIVATE    :  8, //
  REFRESH       :  9, //"refreshToken DASH_ID"
  TWEET         :  12,
  EMAIL         :  13,
  NOTIFY        :  14,
  BRIDGE        :  15,
  HW_SYNC       :  16,
  INTERNAL      :  17,
  SMS           :  18,
  PROPERTY      :  19,
  HW            :  20,

  REDIRECT      :  41,
  DEBUG_PRINT   :  55,

  EVENT_LOG     :  64,
};

var MsgStatus = {
  OK                    :  200,
  ILLEGAL_COMMAND       :  2,
  ALREADY_REGISTERED    :  4,
  INVALID_TOKEN         :  9
};

var BlynkState = {
  CONNECTING    :  1,
  CONNECTED     :  2,
  DISCONNECTED  :  3
};

if (isBrowser()) {
  var bl_browser = require('./blynk-browser.js');
  var events = require('events');
  var util = require('util');
} else if (isNode()) {
  var bl_node = require('./blynk-node.js');
  var events = require('events');
  var util = require('util');
  ab2str = bl_node.ab2str;
  str2ab = bl_node.str2ab;
}

/*
 * Serial
 */
if (isEspruino()) {

  var EspruinoSerial = function(options) {
    var self = this;

    var options = options || {};
    self.ser  = options.serial || USB;
    self.conser = options.conser || Serial1;
    self.baud = options.baud || 9600;

    this.write = function(data) {
      self.ser.write(data);
    };

    this.connect = function(done) {
      self.ser.setup(self.baud);
      self.ser.removeAllListeners('data');
      self.ser.on('data', function(data) {
        self.emit('data', data);
      });
      if (self.conser) {
        self.conser.setConsole();
      }
      done();
    };

    this.disconnect = function() {
      //self.ser.setConsole();
    };
  };

  var EspruinoTCP = function(options) {
    var self = this;

    var options = options || {};
    self.addr = options.addr || "blynk-cloud.com";
    self.port = options.port || 80;

    var net = require('net');

    this.write = function(data) {
      if (self.sock) {
        self.sock.write(data, 'binary');
      }
    };

    this.connect = function(done) {
      if (self.sock) {
        self.disconnect();
      }
      console.log("Connecting to TCP:", self.addr, self.port);
      self.sock = net.connect({host : self.addr, port: self.port}, function() {
        console.log('Connected');
        self.sock.on('data', function(data) {
          self.emit('data', data);
        });
        self.sock.on('end', function() {
          self.emit('end', '');
        });
        done();
      });
    };

    this.disconnect = function() {
      if (self.sock) {
        self.sock = null;
      }
    };
  };

  var BoardEspruinoPico = function(values) {
    var self = this;
    this.init = function(blynk) {
      self.blynk = blynk;
    };
    this.process = function(values) {
      switch(values[0]) {
        case 'pm':
          // TODO
          break;
        case 'dw':
          var pin = Pin(values[1]);
          var val = parseInt(values[2]);
          pinMode(pin, 'output');
          digitalWrite(pin, val);
          break;
        case 'dr':
          var pin = Pin(values[1]);
          self.blynk.sendMsg(MsgType.HW, ['dw', values[1], digitalRead(pin)]);
          break;
        case 'aw':
          var pin = Pin(values[1]);
          var val = parseFloat(values[2]);
          pinMode(pin, 'output');
          analogWrite(pin, val / 255);
          break;
        case 'ar':
          var pin = Pin(values[1]);
          self.blynk.sendMsg(MsgType.HW, ['aw', values[1], 4095 * analogRead(pin)]);
          break;
        default:
          return null;
      }
      return true;
    };
  };

  var BoardEspruinoLinux = function(values) {
    var self = this;
    this.init = function(blynk) {
      self.blynk = blynk;
    };
    this.process = function(values) {
      switch(values[0]) {
        case 'pm':
          // TODO
          break;
        case 'dw':
          var pin = Pin('D' + values[1]);
          var val = parseInt(values[2]);
          pinMode(pin, 'output');
          digitalWrite(pin, val);
          break;
        case 'dr':
          var pin = Pin('D' + values[1]);
          self.blynk.sendMsg(MsgType.HW, ['dw', values[1], digitalRead(pin)]);
          break;
        case 'aw':
        case 'ar':
          break;
        default:
          return null;
      }
      return true;
    };
  };
}

/*
 * Boards
 */

var BoardDummy = function() {
  this.init = function(blynk) {};
  this.process = function(values) {
    switch (values[0]) {
    case 'pm':
      return true;
    case 'dw':
    case 'dr':
    case 'aw':
    case 'ar':
      console.log("No direct pin operations available.");
      console.log("Maybe you need to install mraa or onoff modules?");
      return true;
    }
  };
};

/*
 * Blynk
 */

var Blynk = function(auth, options) {
  var self = this;
  if (needsEmitter()) {
    events.EventEmitter.call(this);
  }

  this.auth = auth;
  var options = options || {};
  this.heartbeat = options.heartbeat || (10*1000);

  console.log("\n\
    ___  __          __\n\
   / _ )/ /_ _____  / /__\n\
  / _  / / // / _ \\/  '_/\n\
 /____/_/\\_, /_//_/_/\\_\\\n\
        /___/\n\
\n\
  Give Blynk a Github star! => https://github.com/vshymanskyy/blynk-library-js\n\
");

  // Auto-detect board
  if (options.board) {
    this.board = options.board;
  } else if (isEspruino()) {
    this.board = new BoardEspruinoPico();
  } else if (isBrowser()) {
    this.board = new BoardDummy();
  } else {
    [
        bl_node.BoardMRAA,
        bl_node.BoardOnOff,
        BoardDummy
    ].some(function(b){
      try {
        self.board = new b();
        return true;
      }
      catch (e) {
        return false;
      }
    });
  }
  self.board.init(self);

  // Auto-detect connector
  if (options.connector) {
    this.conn = options.connector;
  } else if (isEspruino()) {
    this.conn = new EspruinoTCP(options);
  } else if (isBrowser()) {
    this.conn = new bl_browser.WsClient(options);
  } else {
    this.conn = new bl_node.SslClient(options);
  }

  this.buff_in = new Uint8Array();;
  this.msg_id = 1;
  this.vpins = [];
  this.profile = options.profile;

  this.VirtualPin = function(vPin) {
    if (needsEmitter()) {
      events.EventEmitter.call(this);
    }
    this.pin = vPin;
    self.vpins[vPin] = this;

    this.write = function(value) {
      self.virtualWrite(this.pin, value);
    };
  };

  this.WidgetBridge = function(vPin) {
    this.pin = vPin;

    this.setAuthToken = function(token) {
      self.sendMsg(MsgType.BRIDGE, [this.pin, 'i', token]);
    };
    this.digitalWrite = function(pin, val) {
      self.sendMsg(MsgType.BRIDGE, [this.pin, 'dw', pin, val]);
    };
    this.analogWrite = function(pin, val) {
      self.sendMsg(MsgType.BRIDGE, [this.pin, 'aw', pin, val]);
    };
    this.virtualWrite = function(pin, val) {
      self.sendMsg(MsgType.BRIDGE, [this.pin, 'vw', pin].concat(val));
    };
  };

  this.WidgetTerminal = function(vPin) {
    if (needsEmitter()) {
      events.EventEmitter.call(this);
    }
    this.pin = vPin;
    self.vpins[vPin] = this;

    this.write = function(data) {
      self.virtualWrite(this.pin, data);
    };
  };

  this.WidgetLCD = function(vPin) {
    this.pin = vPin;

    this.clear = function() {
      self.virtualWrite(this.pin, 'clr');
    };
    this.print = function(x, y, val) {
      self.sendMsg(MsgType.HW, ['vw', this.pin, 'p', x, y, val]);
    };
  };
  
  this.WidgetTable = function(vPin) {
    this.pin = vPin;

    this.clear = function() {
      self.virtualWrite(this.pin, 'clr');
    };
    
    this.add_row = function(id, name, value) {
      self.virtualWrite(this.pin, ['add', id, name, value]);
    };
    
    this.update_row = function(id, name, value) {
	  self.virtualWrite(this.pin, ['update', id, name, value]);
    };

    this.highlight_row = function(id) {
      self.virtualWrite(this.pin, ['pick', id]);
    };

    this.select_row = function(id) {
      self.virtualWrite(this.pin, ['select', id]);
    };

    this.deselect_row = function(id) {
      self.virtualWrite(this.pin, ['deselect', id]);
    };

    this.move_row = function(old_row, new_row) {
      self.virtualWrite(this.pin, ['order', old_row, new_row]);
    };
  };

  this.WidgetLED = function(vPin) {
    this.pin = vPin;

    this.setValue = function(val) {
      self.virtualWrite(this.pin, val);
    };
    this.turnOn = function() {
      self.virtualWrite(this.pin, 255);
    };
    this.turnOff = function() {
      self.virtualWrite(this.pin, 0);
    };
  };
  
  this.WidgetMAP = function(vPin) {
    this.pin = vPin;
    
    this.location = function(index, lat, lon, value) {
      var locationdata = [index, lat, lon, value]
      self.virtualWrite(this.pin, locationdata);
    }
  };

  if (needsEmitter()) {
    util.inherits(this.VirtualPin, events.EventEmitter);
    util.inherits(this.WidgetBridge, events.EventEmitter);
    util.inherits(this.WidgetTerminal, events.EventEmitter);
  }

  if (!options.skip_connect) {
    this.connect();
  }
};

if (needsEmitter()) {
  util.inherits(Blynk, events.EventEmitter);
}

Blynk.prototype.onReceive = function(data) {
  var self = this;
  self.buff_in = new Uint8Array(mergeBuffer(self.buff_in.buffer, data));
  while (self.buff_in.byteLength >= 5) {
    var msg_type = self.buff_in[0];
    var msg_id   = self.buff_in[1] << 8 | self.buff_in[2];
    var msg_len  = self.buff_in[3] << 8 | self.buff_in[4];

    if (msg_id === 0)  { return self.disconnect(); }

    if (msg_type === MsgType.RSP) {
      //console.log('> ', string_of_enum(MsgType, msg_type), msg_id, string_of_enum(MsgStatus, msg_len));
      if (!self.profile) {
        if (self.timerConn && msg_id === 1) {
          if (msg_len === MsgStatus.OK || msg_len === MsgStatus.ALREADY_REGISTERED) {
            clearInterval(self.timerConn);
            self.timerConn = null;
            self.timerHb = setInterval(function() {
              console.log('Heartbeat');
              self.sendMsg(MsgType.PING);
            }, self.heartbeat);
            console.log('Authorized');
            self.sendMsg(MsgType.INTERNAL, ['ver', '0.5.3', 'buff-in', 4096, 'dev', 'js']);
            self.emit('connect');
          } else {
            console.log('Could not login:', string_of_enum(MsgStatus, msg_len));
            //if invalid token, no point in trying to reconnect
            if (msg_len === MsgStatus.INVALID_TOKEN) {
              //letting main app know why we failed
              self.emit('error', string_of_enum(MsgStatus, msg_len));
              console.log('Disconnecting because of invalid token');
              self.disconnect();
              if(self.timerConn) {
                //clear connecting timer
                console.log('clear conn timer');
                clearInterval(self.timerConn);
                self.timerConn = null;
              }
            }
          }
        }
      }
      self.buff_in = self.buff_in.slice(5);
      continue;
    }

    if (msg_len > 4096)  { return self.disconnect(); }
    if (self.buff_in.byteLength < msg_len+5) {
      return;
    }

    var values = decodeValues(self.buff_in.slice(5, msg_len + 5));
    self.buff_in = self.buff_in.slice(msg_len + 5);

    /*if (msg_len) {
      console.log('> ', string_of_enum(MsgType, msg_type), msg_id, msg_len, values.join('|'));
    } else {
      console.log('> ', string_of_enum(MsgType, msg_type), msg_id, msg_len);
    }*/

    if (msg_type === MsgType.LOGIN ||
        msg_type === MsgType.PING)
    {
      self.sendRsp(MsgType.RSP, msg_id, MsgStatus.OK);
    } else if (msg_type === MsgType.GET_TOKEN) {
      self.sendRsp(MsgType.GET_TOKEN, msg_id, self.auth);
    } else if (msg_type === MsgType.LOAD_PROF) {
      self.sendRsp(MsgType.LOAD_PROF, msg_id, self.profile);
    } else if (msg_type === MsgType.HW ||
               msg_type === MsgType.BRIDGE)
    {
      if (values[0] === 'vw') {
        var pin = parseInt(values[1]);
        if (self.vpins[pin]) {
          self.vpins[pin].emit('write', values.slice(2));
        }
      } else if (values[0] === 'vr') {
        var pin = parseInt(values[1]);
        if (self.vpins[pin]) {
          self.vpins[pin].emit('read');
        }
      } else if (self.board.process(values)) {

      } else {
        console.log('Invalid cmd: ', values[0]);
        //self.sendRsp(MsgType.RSP, msg_id, MsgStatus.ILLEGAL_COMMAND);
      }
    } else if (msg_type === MsgType.REDIRECT) {
      self.conn.addr = values[0];
      if (values[1]) {
        self.conn.port = parseInt(values[1]);
      }
      console.log('Redirecting to ', self.conn.addr, ':', self.conn.port);
      self.disconnect();
    } else if (msg_type === MsgType.DEBUG_PRINT) {
      console.log('Server: ', values[0]);
    } else if (msg_type === MsgType.REGISTER ||
               msg_type === MsgType.SAVE_PROF ||
               msg_type === MsgType.INTERNAL ||
               msg_type === MsgType.ACTIVATE ||
               msg_type === MsgType.DEACTIVATE ||
               msg_type === MsgType.REFRESH)
    {
      // these make no sense...
    } else {
      console.log('Invalid msg type: ', msg_type);
      self.sendRspStatus(MsgType.RSP, msg_id, MsgStatus.ILLEGAL_COMMAND);
    }
  } // end while
};

Blynk.prototype.send = function(msg_type, msg_id, status_or_msg_len, data) {
  var self = this;
  data = data || new ArrayBuffer();

  if (!msg_id) {
    if (self.msg_id === 0xFFFF)
      self.msg_id = 1;
    else
      self.msg_id++;

    msg_id = self.msg_id;
  }

  var header = blynkHeader(msg_type, msg_id, status_or_msg_len);
  if (msg_type == MsgType.RSP) {
    // console.log('< ', string_of_enum(MsgType, msg_type), msg_id, string_of_enum(MsgStatus, status_or_msg_len));
    data = header;
  } else {
    /*if (status_or_msg_len) {
      console.log('< ', string_of_enum(MsgType, msg_type), msg_id, status_or_msg_len, decodeValues(data).join('|'));
    } else {
      console.log('< ', string_of_enum(MsgType, msg_type), msg_id, status_or_msg_len);
    }*/
    data = mergeBuffer(header, data);
  }

  self.conn.write(data);

  // TODO: track also recieving time
  /*if (!self.profile) {
    if (self.timerHb) {
      clearInterval(self.timerHb);
      self.timerHb = setInterval(function(){
        //console.log('Heartbeat');
        self.sendMsg(MsgType.PING);
      }, self.heartbeat);
    }
  }*/
};

Blynk.prototype.sendRsp = function(msg_type, msg_id, status_or_data) {
  if (typeof status_or_data === 'string') {
    var data = str2ab('' + status_or_data);
    this.send(msg_type, msg_id, data.byteLength, data);
  } else {
    this.send(msg_type, msg_id, status_or_data);
  }
};

Blynk.prototype.sendMsg = function(msg_type, values, msg_id) {
  if (this.timerHb) {
    var data = values || [''];
    if (data instanceof Array) {
      data = encodeValues(data);
    } else if (data !== null) {
      data = str2ab(data);
    } else {
      data = new ArrayBuffer();
    }
    this.send(msg_type, msg_id, data.byteLength, data);
  }
};

/*
  * API
  */

Blynk.prototype.connect = function() {
  var self = this;

  var doConnect = function() {
    if(self.conn) {
      //cleanup events
      self.conn.removeAllListeners();
    }
    self.conn.connect(function() {
      self.conn.on('data', function(data) { self.onReceive(data);     });
      self.conn.on('end',  function()     { self.end();               });

      self.sendRsp(MsgType.LOGIN, 1, self.auth);
    });
    self.conn.on('error', function(err) { self.error(err);            });
  };

  if (self.profile) {
    doConnect();
  } else {
    self.timerConn = setInterval(doConnect, 10000);
    doConnect();
  }
};

Blynk.prototype.disconnect = function(reconnect) {
  console.log('Disconnect blynk');
  if(typeof reconnect === 'undefined' ) {
    reconnect = true;
  }

  var self = this;
  this.conn.disconnect();
  if (this.timerHb) {
    clearInterval(this.timerHb);
    this.timerHb = null;
  }
  this.emit('disconnect');
  //cleanup to avoid multiplying listeners
  this.conn.removeAllListeners();

  //starting reconnect procedure if not already in connecting loop and reconnect is true
  if(reconnect && !self.timerConn) {
    console.log("REARMING DISCONNECT");
    setTimeout(function () {self.connect()}, 5000);
  }
};

Blynk.prototype.error = function(err) {
  var self = this;
  //if we throw error and user doesn't handle it, app crashes. is it worth it?
  this.emit('error', err.code?err.code:'ERROR');
  console.error('Error', err.code);
  //starting reconnect procedure if not already in connecting loop
  if(!self.timerConn) {
    setTimeout(function () {self.connect()}, 5000);
  }
};

Blynk.prototype.end = function() {
  var self = this;
  self.disconnect();
};


Blynk.prototype.virtualWrite = function(pin, val) {
  this.sendMsg(MsgType.HW, ['vw', pin].concat(val));
};

Blynk.prototype.setProperty = function(pin, prop, val) {
  this.sendMsg(MsgType.PROPERTY, [pin, prop].concat(val));
};

Blynk.prototype.eventLog = function(name, descr) {
  this.sendMsg(MsgType.EVENT_LOG, [name].concat(descr));
};

Blynk.prototype.syncAll = function() {
  this.sendMsg(MsgType.HW_SYNC);
};

Blynk.prototype.syncVirtual = function(pin) {
  this.sendMsg(MsgType.HW_SYNC, ['vr', pin]);
};


Blynk.prototype.email = function(to, topic, message) {
  this.sendMsg(MsgType.EMAIL, [to, topic, message]);
};

Blynk.prototype.notify = function(message) {
  this.sendMsg(MsgType.NOTIFY, [message]);
};

Blynk.prototype.tweet = function(message) {
  this.sendMsg(MsgType.TWEET, [message]);
};

Blynk.prototype.sms = function(message) {
  this.sendMsg(MsgType.SMS, [message]);
};

if (typeof module !== 'undefined' && ('exports' in module)) {
  exports.Blynk = Blynk;

  if (isEspruino()) {
    exports.EspruinoSerial = EspruinoSerial;
    exports.EspruinoTCP = EspruinoTCP;
    exports.BoardLinux = BoardEspruinoLinux;
    exports.BoardPico  = BoardEspruinoPico;
  } else if (isBrowser()) {
    exports.WsClient = bl_browser.WsClient;
  } else if (isNode()) {
    exports.TcpClient = bl_node.TcpClient;
    exports.TcpServer = bl_node.TcpServer;
    exports.SslClient = bl_node.SslClient;
    exports.SslServer = bl_node.SslServer;
    exports.BoardOnOff = bl_node.BoardOnOff;
    exports.BoardMRAA = bl_node.BoardMRAA;
  }
}
