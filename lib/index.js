'use strict';

// I don't know why, but some modules don't work in node.js 0.10
if (parseInt(process.version.replace(/v(\d+)\.(\d+).*/, '$1.$2'), 10) < 4) {
  console.log('Please upgrade node.js to v4.3 or greater');
  console.log('');
  console.log('For just node.js:');
  console.log('    curl -L bit.ly/nodejs-min | bash');
  console.log('');
  console.log('For node.js + development tools:');
  console.log('    curl -L bit.ly/nodejs-dev-install -o ./node-dev; bash ./node-dev');
  console.log('');
  process.exit();
}

// TODO preserve history
// each time a selection is made it should be masked (if secret),
// placed on the first line, the cursor should move to the end line,
// and then a newline should be entered at the bottom to scroll the
// top line up one and then the screen should be rewritten.
// In this way the user should have a history of his / her actions.

var PromiseA = require('bluebird');
var path = require('path');
var colors = require('colors/safe');
var authenticator = require('authenticator');
var qrcode = require('qrcode-terminal');
var A = require('../lib/oauth3');
var A3 = require('../lib/utils');
var jwt = require('jsonwebtoken');
//var stripe = require('./lib/stripe');
var stripeId = require('./config.stripe').live.id;
var stripe = require('stripe')(stripeId);

var BKSP = String.fromCharCode(127);
var WIN_BKSP = "\u0008";
var ENTER = "\u0004";           // 13 // '\u001B[0m'
var CTRL_C = "\u0003";
var TAB = '\x09';
var ARROW_UP = '\u001b[A';      // 38
var ARROW_DOWN = '\u001b[B';    // 40
var ARROW_RIGHT = '\u001b[C';   // 39
var ARROW_LEFT = '\u001b[D';    // 37

// https://www.novell.com/documentation/extend5/Docs/help/Composer/books/TelnetAppendixB.html
var code = [
  ['u', 'w', 'i']
, ['u', 'w', 'i']
, ['d', 's', 'k']
, ['d', 's', 'k']
, ['l', 'a', 'j']
, ['r', 'd', 'l']
, ['l', 'a', 'j']
, ['r', 'd', 'l']
, ['b']
, ['a']
, [' ']
];
var CLI = {};
var STATE = {};

/* setting rcpath to work around perms issue */
var tldsCacheDir = path.join(require('homedir')(), '.oauth3', 'caches', 'tlds');

// it's probably more expensive to write piecemeal than it is
// to just write the whole new thing all at once, but whatever
/*
function writeDiff(ws, cur, next) {
  var cols = ws.columns;
  var rows = ws.rows;

  (new Array(rows + 1).join(',').split(',')).forEach(function (_, x) {
    (new Array(cols + 1).join(',').split(',')).forEach(function (_, y) {
      if (cur[x][y] !== next[x][y]) {
        ws.cursorTo(x, y);
        ws.write(next[x][y]);
      }
    });
  });
}
*/

function range(n) {
  return (new Array(n).join('x').split('x'));
}

function debug(ws, state, msg) {
  // TODO scrolling debug log
  state.debugs.push(msg);
  while (state.debugs.length > 3) {
    state.debugs.shift();
  }
  say(ws, state, state.debugs, 3);
}

function clearScreen(ws) {
  // msysgit on Windows is not a valid terminal
  if (!ws.columns || !ws.rows) {
    console.log("");
    console.log("Your console does not correctly report its width and height.");
    console.log("This is a known issue with some Windows consoles, such as msysgit");
    console.log("");
    console.log("Windows Users: Please try use cmd.exe, PowerShell, or bash (Win10/Ubuntu)");
    console.log("Others: Please try Terminal, iTerm, or Konsole");
    console.log("");
    console.log("If you need help, please make an issue at https://github.com/OAuth3/oauth3-cli/issues");
    console.log("");
    process.exit(1);
  }
  // We could use `process.stdout.write('\x1Bc');`
  // but that would send the clear screen signal,
  // which would cause the screen to scroll in the
  // history. Instead we want to blank the current
  // screen in-place.
  var cols = ws.columns;
  var rows = ws.rows;
  var line = (new Array(cols + 1)).join(' ') + '\n';

  ws.cursorTo(0, 0);
  (new Array(rows).join('x').split('x')).forEach(function () {
    ws.write(line);
  });
}

function writeMenu(ws, state) {
  var cols = ws.columns;
  var rows = ws.rows;
  var line = (new Array(cols + 1)).join(' ') + '\n';
  var size = state.codes.split('').map(function () {
    return '█';
  }).join('');

  if (state.codeComplete) {
    size = colors.cyan(size);
  }
  size += ' [' + cols + 'x' + rows + ']';
  var msg = "OAuth3";

  // Header
  ws.cursorTo(0, 0);
  ws.write(msg + (line.slice(0, cols - (msg.length + size.length))) + size);
  ws.write(line.replace(/./g, '-'));

  // Footer
  ws.cursorTo(0, rows - 2);
  ws.write(line.replace(/./g, '-'));

  ws.cursorTo(0, rows - 1);
  writePrompt(ws, state);
}

// excuse me. EXCUSE ME. SECURDY SE-CURDY.
// We got a complicated terminal
function dollarBillCheck(stream, state) {
  var cols = stream.columns;
  var rows = stream.rows;
  var minCols = Math.max(state.minCols || 80);
  var minRows = Math.max(state.minRows || 24);

  /*
  if ('qr' === state.state) {
    console.log('Current Size:', cols + 'x' + rows);
    console.log('Needed Size:', minCols + 'x' + minRows);
    console.log('Fits:', cols >= minCols, rows >= minRows);
    process.exit(1);
  }
  //*/

  if (cols >= minCols && rows >= minRows) {
    if (state.__pause_input) {
      // restore the previous messages
      state.prompt = state.__pause_prompt;
      state.__pause_input = false;
    }
    return true;
  }

  // backup the current messages
  if (!state.__pause_input) {
    state.__pause_input = true;
    state.__pause_prompt = state.prompt;
  }

  clearScreen(stream);
  /*
  // This will DESTROY the OCD
  // There will be no survivors!!!
  // (as soon as you get the size right, the message goes away)
  stream.write("Did you know that the 80x24 terminal was modeled after the size of a dollar bill?\n");  // 2
  stream.write("FACT: http://programmers.stackexchange.com/q/148677\n");                                // 1
  stream.write("\n\n\n\n\n\n\n\n");                                                                     // 8
  stream.write("\n\n\n\n\n\n\n\n");                                                                     // 8
  stream.write("And do you know who doesn't support terminals smaller than a 1890 US dollar bill?\n");  // 2
  stream.write("FACT: us\n");                                                                           // 2
  // SIZE MATTERS, it's not just how you use it!
  // prompt shows up as final line
  */

  state.prompt = '[Resize Window to Continue]';
  var msgs = [
    "Please resize this terminal"
  , ""
  , "Note: You may need to use CTRL- or CMD- if your screen is small."
  , ""
  , "[ Current Window Size: " + cols + "x" + rows + " ]"
  , ""
  , "[ Required Window Size: " + Math.max(minCols, cols) + "x" + Math.max(minRows, rows) + " ]"
  , ""
  , ""
  , "[ Fun Fact ]"
  , "Did you know that the default terminal size of 80x24"
  , "shares history with the US dollar bill? (bit.ly/1QTacCf)"
  ];

  writeMenu(stream, state);
  say(stream, state, msgs/*, y*/);

  return false;
}

function say(ws, state, msgs, y) {
  var stripAnsi = require('strip-ansi');
  var cols = ws.columns;
  var rows = ws.rows;

  if (!msgs) {
    msgs = state.msgs;
  }
  if (!y && 0 !== y) {
    y = Math.ceil(rows / 2) - Math.floor(msgs.length / 2);
  }

  msgs.forEach(function (msg) {
    var x = Math.floor(cols / 2) - Math.floor(stripAnsi(msg).length / 2);
    ws.cursorTo(x, y);
    ws.write(msg);
    y += 1;
  });

  ws.cursorTo(0, cols);
}

function qr(ws, state) {
  var stripAnsi = require('strip-ansi');
  var cols = ws.columns;
  //var rows = ws.rows;
  var x = 3; // padding
  var y = 3; // headers

  state.minCols = state.msgs.reduce(function (n, msg) {
    return Math.max(n, stripAnsi(msg || '').length);
  }, 0);
  state.minRows = (state.msgs.length - 1)
    + 6 // headers + footers
    + state.qr.split('\n').length
  ;

  if (!reComputeHelper(ws, state)) {
    // don't try to write to screen
    return;
  }

  ws.cursorTo(x, y);

  state.msgs.forEach(function (msg) {
    if ('__RAW__' === msg) {
      ws.cursorTo(0, y);
      ws.write(state.qr);
      y += state.qr.split('\n').length;
    } else {
      ws.cursorTo(x, y);
      ws.write(msg);
      y += 1;
    }
  });

  ws.cursorTo(0, cols);

  writeMenu(ws, {
    title: state.title
  , codes: state.codes
  , prompt: state.prompt
  , isSecret: state.isSecret
  , unmask: state.unmask
  });

  state.minCols = 0;
  state.minRows = 0;
}

function reComputeHelper(ws, state) {
  var cols = ws.columns;
  var rows = ws.rows;

  state.width = cols;
  state.height = rows;

  clearScreen(ws, state);
  // TODO check needed w x h
  return dollarBillCheck(ws, state);
}

function reCompute(ws, state) {
  if ('qr' === state.state) {
    qr(ws, state);
  } else {
    if (reComputeHelper(ws, state)) {
      say(ws, state);
      writeMenu(ws, state);
    }
  }
}

function checkCodes(ws, state) {
  var nextChars = code[state.codes.length] || [];
  var ch = state.ch;

  switch (ch) {
  case ENTER:
    ch = ' ';
    break;
  case ARROW_UP:
    ch = 'w';
    break;
  case ARROW_DOWN:
    ch = 's';
    break;
  case ARROW_LEFT: // TODO handle left
    ch = 'a';
    break;
  case ARROW_RIGHT:
    ch = 'd';
    break;
  default:
    break;
  }

  if (-1 === nextChars.indexOf(ch)) {
    state.codes = '';
    reCompute(ws, state);
    return;
  }

  state.codes += ch;
  writeMenu(ws, state);
  if (code.length === state.codes.length) {
    state.state = '!!!';
    state.msgs = [colors.rainbow('hadouken!!!')];
    say(ws, state);
    return;
  }
}

function hint(ws, state) {
  var start;
  var part;
  var complete;

  if (!state.hint) {
    ws.write(state.input);
    return;
  }

  start = state.input;
  part = state.hint.slice(start.length);
  complete = colors.bold(start) + colors.dim(part);

  //ws.clearLine();
  ws.cursorTo(0);
  writePrompt(ws, state);
  ws.write(complete);
  ws.moveCursor(-1 * part.length, 0);
}

function search(ws, state) {
  var hints = state.hints.filter(function (provider) {
    //return provider.toLowerCase().match(new RegExp(escapeRe('^' + state.input)));
    return (state.input || state.autohint) && 0 === provider.toLowerCase().indexOf(state.input);
  });

  state.hint = hints[0] || '';
  hint(ws, state);
}

function getEmailHints(input) {
  // TODO also include known providers (oauth3.org, facebook.com, etc)
  // and previously used email addresses
  var provider = input.replace(/.*@/, '').toLowerCase();

  if (input.length < 3) {
    return [];
  }

  return [
    'gmail.com'
  , 'yahoo.com'
  , 'ymail.com'
  , 'outlook.com'
  , 'hotmail.com'
  , 'live.com'
  , 'msn.com'
  , 'yandex.com'
  , 'aol.com'
  , 'icloud.com'
  , 'me.com'
  , 'mail.com'
  , 'gmx.com'
  , 'inbox.com'
  , 'lycos.com'
  , 'zoho.com'
  , 'hushmail.com'
  , 'hushmail.me'
  , 'hush.com'
  , 'hush.ai'
  , 'mac.hush.com'
  ].filter(function (str) {
    return 0 === str.indexOf(provider);
  }).map(function (str) {
    if (!provider) {
      return input.replace(/@/, '') + '@' + str;
    }
    return input + str.substr(provider.length);
  });
}

function getCcRule(num) {
	var rule = {
		name: 'Credit Card'
  , abbr: 'unknown'
	, format: 'xxxx-xxxx-xxxx-yyyy'
  , cvc: 'xxx'
	};
	var defaultRule = rule;
  var ccs = [
		{ abbr: 'electron'
		, name: 'Electron'
		, re: /^(4026|417500|4405|4508|4844|4913|4917)\d+$/
		}
	, { abbr: 'maestro'
		, name: 'Maestro'
		, re: /^(5018|5020|5038|5612|5893|6304|6759|6761|6762|6763|0604|6390)\d+$/
		}
	, { abbr: 'dankort'
		, name: 'Dankort'
		, re: /^(5019)\d+$/
		}
	, { abbr: 'interpayment'
		, name: 'InterPayment'
		, re: /^(636)\d+$/
		}
	, { abbr: 'unionpay'
		, name: 'UnionPay'
		, re: /^(62|88)\d+$/
		}
	, { abbr: 'visa'
		, name: 'Visa'
		, re: /^4[0-9]{0,12}(?:[0-9]{3})?$/
		, format: 'xxxx-xxxx-xxxx-yyyy'
		}
	, { abbr: 'mastercard'
		, name: 'MasterCard'
		, re: /^5[1-5][0-9]{0,14}$/
		, format: 'xxxx-xxxx-xxxx-yyyy'
		}
	, { abbr: 'amex'
		, name: 'American Express'
		, re: /^3[47][0-9]{0,13}$/
		, format: 'xxxx-xxxxxx-xyyyy'
    , cvc: 'xxxx'
		}
	, { abbr: 'diners'
		, name: 'Diners Club'
		, re: /^3(?:0[0-5]|[68][0-9])[0-9]{0,11}$/
		}
	, { abbr: 'discover'
		, name: 'Discover'
		, re: /^6(?:011|5[0-9]{2})[0-9]{0,12}$/
		, format: 'xxxx-xxxx-xxxx-yyyy'
		}
	, { abbr: 'jcb'
		, name: 'JCB'
		, re: /^(?:2131|1800|35\d{3})\d{0,11}$/
		}
  ];
	var maxlen = ccs.reduce(function (max, dir) { return Math.max(max, dir.name.length); }, 0) + 1;

	num = num.replace(/\D/g, '');
	ccs.some(function (_rule) {
		if (_rule.re.test(num)) {
			rule = _rule;
			return true;
		}
	});
	rule.format = rule.format || defaultRule.format;
	rule.cvc = rule.cvc || defaultRule.cvc;
  rule.maxlen = maxlen;

  return rule;
}

function formatCcNumber(ws, state) {
  // http://stackoverflow.com/questions/72768/how-do-you-detect-credit-card-type-based-on-number
  var rule = getCcRule(state.input);
	var	arr;
	var prevc;
	var complete;
	var part;
	var input = '';

	state.input = state.input.replace(/\D/g, '');

  state.ccRule = rule;

	arr = state.input.split('');
	rule.format.split('').forEach(function (ch) {
		var c;

		if ('x' === ch || 'y' === ch) {
 			c = arr.shift();
			if ('y' === ch || state.unmask || !arr.length) {
				input += (c && c || '');
			} else {
				input += (c && '*' || '');
			}
		}
		else if ('-' === ch) {
			if (prevc) {
				input += ch;
			}
		}
		else {
			console.error('Internal Error (not your fault): Unexpected Card Format: ' + rule.format);
			process.exit(1);
		}

		prevc = c;
	});
  if (arr.length) {
    input += '-' + arr.join('');
  }

	part = rule.format.substr(input.length);
  complete = colors.bold(input) + colors.dim(part.replace(/y/g, 'x'));
	state.prompt = rule.name;
	while (state.prompt.length < rule.maxlen) {
		state.prompt += ' ';
	}

  ws.cursorTo(0);
  writePrompt(ws, state);
  ws.write(complete);
  ws.moveCursor(-1 * part.length, 0);
}

function formatCcExp(ws, state) {
  // TODO enforce that the expiration must be no sooner than yesterday
  // (this should account for international date drift)
  // TODO enforce
	var	arr;
	var prevc;
	var complete;
	var part;
	var input = '';
  var format = 'mm/yy';
  var month = 0;

  //  '0' -> 0
  //  '1' -> 1
  //  '2' -> 02
  // '1/' -> 01
  // '13' -> 1
  if (/0-9/.test(state.input[0]) && '/' === state.input[1]) {
    state.input = '0' + state.input;
  }
	state.input = state.input.replace(/\D/g, '');
  if (state.input[0] > 1) {
    state.input = '0' + state.input;
  }
  month = parseInt(state.input.substr(0, 2), 10) || 0;
  if (month < 1 || month > 12) {
    state.input = state.input[0] || '';
  }
  state.input = state.input.substr(0, 4);

	arr = state.input.split('');
	format.split('').forEach(function (ch) {
		var c;

		if ('m' === ch || 'y' === ch) {
 			c = arr.shift();
			if (state.unmask || !arr.length) {
				input += (c && c || '');
			} else {
				input += (c && '*' || '');
			}
		}
		else if ('/' === ch) {
			if (prevc) {
				input += ch;
			}
		}
		else {
			console.error('Internal Error (not your fault): Unexpected Expiration Format: ' + format);
			process.exit(1);
		}

		prevc = c;
	});
  if (arr.length) {
    input += '/' + arr.join('');
  }

	part = format.substr(input.length);
  complete = colors.bold(input) + colors.dim(part);

  ws.cursorTo(0);
  writePrompt(ws, state);
  ws.write(complete);
  ws.moveCursor(-1 * part.length, 0);
}

function formatCcCvc(ws, state) {
  var rule = state.ccRule;
	var	arr;
	var prevc;
	var complete;
	var part;
	var input = '';

	state.input = state.input.replace(/\D/g, '');

	arr = state.input.split('');
	rule.cvc.split('').forEach(function (ch) {
		var c;

		if ('x' === ch) {
 			c = arr.shift();
			if (state.unmask || !arr.length) {
				input += (c && c || '');
			} else {
				input += (c && '*' || '');
			}
		}
		else {
			console.error('Internal Error (not your fault): Unexpected CVC Format: ' + rule.cvc);
			process.exit(1);
		}

		prevc = c;
	});

  if (arr.length) {
    if (state.unmask) {
      input += arr.join('');
    } else {
      input += arr.map(function () { return '*'; }).join('');
    }
  }

	part = rule.cvc.substr(input.length);
  complete = colors.bold(input) + colors.dim(part);

  ws.cursorTo(0);
  writePrompt(ws, state);
  ws.write(complete);
  ws.moveCursor(-1 * part.length, 0);
}

function handleCcNumber(ws, state, cb) {
  state.isSecret = true;
	state.inputCallback = formatCcNumber;

  handleInput(ws, state, function (err, result) {
    state.isSecret = false;
		state.inputCallback = null;
    cb(err, result);
  });

  // pre-fill suggestion
	state.inputCallback(ws, state);
}

function handleCcExp(ws, state, cb) {
  state.isSecret = true;
	state.inputCallback = formatCcExp;

  handleInput(ws, state, function (err, result) {
    state.isSecret = false;
		state.inputCallback = null;
    cb(err, result);
  });

  // pre-fill suggestion
	state.inputCallback(ws, state);
}

function handleCcCvc(ws, state, cb) {
  state.isSecret = true;
	state.inputCallback = formatCcCvc;

  handleInput(ws, state, function (err, result) {
    state.isSecret = false;
		state.inputCallback = null;
    cb(err, result);
  });

  // pre-fill suggestion
	state.inputCallback(ws, state);
}

function handleSecret(ws, state, cb) {
  state.isSecret = true;
  handleInput(ws, state, function (err, result) {
    state.isSecret = false;
    cb(err, result);
  });
}

// TODO debounce
// TODO ignore input during pauses
function handleInput(ws, state, cb) {
  var stdin = process.stdin;
  var debouncer = {
    set: function (fn) {
      clearTimeout(debouncer._timeout);
      if ('function' === typeof fn) {
        debouncer._timeout = setTimeout(function () {
          fn(ws, state);
        }, 300);
      }
    }
  };

  stdin.setRawMode(true);
  stdin.setEncoding('utf8');
  stdin.resume();

  state.input = state.input || '';
  state.hint = '';

  reCompute(ws, state);

  function callback(err, result) {
    stdin.removeListener('data', onData);

    stdin.setRawMode(false);
    stdin.pause();

    state.input = '';
    state.hint = '';
    state.hints = [];

    cb(err, result);
  }

  function onData(ch) {
    debouncer.set(state.debounceCheck, ch);
    state.ch = ch.toString('utf8');
    ch = '';
    checkCodes(ws, state);

    if (CTRL_C === state.ch) {
      console.log("");
      console.log("received CTRL+C and quit");
      process.exit(0);
      callback(new Error("cancelled"));
    }

    if (state.__pause_input) {
      return;
    }

    switch (state.ch) {
    case "\n":
    case "\r":
    case ENTER:
        // TODO pause on enter, check validity via verify, then unpause or close and callback

        if (state.enterCheck) {
          state.enterCheck(ws, state, ENTER).then(function (pass) {
            if (pass) {
              callback(null, state.input);
              return;
            }

            if (state.hint) {
              // state.input = state.hint;
              state.input += state.hint.slice(state.input.length);

              state.enterCheck(ws, state, ENTER).then(function (pass) {
                if (pass) {
                  callback(null, state.input);
                  return;
                }
              });
            }
          });
          return;
        }

        if (state.hint) {
          // state.input = state.hint;
          state.input += state.hint.slice(state.input.length);
        }
        callback(null, state.input);
        return;
        //break;
    case BKSP:
    case WIN_BKSP:
        // filler character for fudging cursor position
        if (/•$/.test(state.input)) {
          state.input = state.input.replace(/•+$/, '');
        }
        else {
          state.input = state.input.slice(0, state.input.length - 1);
        }
        break;
    case ARROW_UP:
        if (state.isSecret) {
          state.unmask = true;
        }
        break;
    case ARROW_DOWN:
        if (state.isSecret) {
          state.unmask = false;
        }
        break;
    case ARROW_LEFT: // TODO handle left
        break;
    case TAB:
    case ARROW_RIGHT:
        if (!state.isSecret && state.hint) {
          ch = state.hint.slice(state.input.length);
        }
        break;
    default:
        // TODO check for utf-8 non-control characters
        ch = state.ch;
        break;
    }

    // More passsword characters
    //process.stdout.write('*');
    state.input += ch;

    if (state.inputCallback) {
      state.inputCallback(ws, state);
      return;
    }

    if (!state.isSecret) {
      search(ws, state);
      return;
    }

    writeSecret(ws, state);
  }

  stdin.on('data', onData);
}

function writePrompt(ws, state) {
  // Prompt
  var prompt = state.prompt || '> ';

  if (state.isSecret) {
    if (state.unmask) {
      prompt += '(↓ to hide)';
    } else {
      prompt += '(↑ to show)';
    }
    prompt += ': ';
  }

  ws.write(prompt);
}

function writeSecret(ws, state) {
  var input;

  ws.cursorTo(0);
  writePrompt(ws, state);
  // TODO support utf8
  if (state.unmask) {
    input = state.input;
  } else {
    input = state.input.split('').map(function () {
      return '*';
    }).join('');
  }

  ws.write(input);
}

CLI.getProviderName = function (ws, state, cb) {
  state.state = 'welcome';
  state.hints = A.providers;
  state.msgs = [
    "Welcome!"
  , "It looks like you don't have any stored credentials or profiles."
  , ""
  , "Where would you like to create an account?"
  , ""
  ];
  A.providers.sort().forEach(function (provider) {
    state.msgs.push("• " + provider);
  });
  state.msgs.push('');
  state.msgs.push('Type the name of one of the account providers above (or any of your choosing)');
  state.error = null;
  state.prompt = '> ';

  // TODO allow commandline argument for provider
  handleInput(ws, state, function (err, input) {
    if (!input) {
      state.error = "";
      CLI.getProviderName(ws, state, cb);
    }

    state.providerUrl = input;
    cb(null);
  });
};

CLI.getId = function (ws, state, cb) {
  state.state = 'login';
  state.msgs = [
    "Login and/or Create Account"
  , ""
  ];
  /*
  Object.keys(state.oauth3).forEach(function (key) {
    var dir = state.oauth3[key];

    if (dir.method) {
      state.msgs.push(key + " [" + dir.method + "] " + dir.url);
    }
  });
  */
  state.msgs.push('');
  state.msgs.push('');
  state.msgs.push('');
  state.msgs.push("Type the email you use (or will use) for " + state.providerUrl + ":");

  state.error = null;

  state.inputCallback = function (ws, state) {
    state.hints = getEmailHints(state.input);
    if (/@/.test(state.username)) {
      state.hints.unshift(state.username);
    }
    search(ws, state);
  };
  handleInput(ws, state, function (err, userId) {
    state.inputCallback = null;
    state.username = userId;

    cb(null);
  });
};

CLI.getToken = function (ws, state, cb) {
  if (state.totpKey) {
    state.totpToken = authenticator.generateToken(state.totpKey);
    cb(null);
    return;
  }

  state.state = 'token';
  state.msgs = [
    "Enter your Two-Factor Auth Code"
  // TODO
  //, ""
  //, "(you can skip by leaving the code blank)"
  ];
  state.prompt = 'Authenticator 6-digit token: ';

  handleInput(ws, state, function (err, token) {
    state.totpToken = token || false;

    cb(null);
  });
};

CLI.createSecret = function (ws, state, cb) {
  state.state = 'secret';
  state.msgs = [
    "Now it's time to create a passphrase"
  , ""
  , "Choose something 16 characters or more"
  ];
  state.prompt = 'Create a Passphrase ';

  handleSecret(ws, state, function (err, secret) {
    state.secret = secret;

    cb(null);
  });
};

function getInput(label, re, ws, state, cb) {
  state.state = 'input';
  //state.msgs = msgs;
  state.error = null;
  state.prompt = label;


  if (state.input && re.test(state.input)) {
    cb(null, state.input);
    state.input = '';
    return;
  }
  /*
  state.inputCallback = function (ws, state) {
    if (!re.test(state.input)) {
      state.input = state.input.slice(0, state.input.length - 1);
    }
  };
  */
  handleInput(ws, state, function (err, result) {
    //state.inputCallback = null;
    if (!re.test(result)) {
      return getInput(label, re, ws, state, cb);
    }

    cb(err, result);
  });

  search(ws, state);
}

function getCcEmail(ws, state, cb) {
  if (state.ccEmail) {
    state.input = state.ccEmail;
  }
  state.state = 'email';
  state.autohint = true;
  state.hints = state.ccEmail && [state.ccEmail]
    || state.username && [state.username]
    || getEmailHints(state.input)
  ;
  state.msgs = [
    "Email Address for Credit Card"
  , ""
  , ""
  , ""
  ];
  state.error = null;
  state.prompt = 'Email Address: ';

  state.inputCallback = function (ws, state) {
    state.hints = getEmailHints(state.input);
    if (/@/.test(state.username)) {
      state.hints.unshift(state.username);
    }
    search(ws, state);
  };
  handleInput(ws, state, function (err, result) {
    state.inputCallback = null;
    state.autohint = false;

    if (!result) {
      state.error = "";
      getCcEmail(ws, state, cb);
    }

    state.email = result;
    cb(err, result);
  });

  search(ws, state);
}

function getCcNumber(ws, state, cb) {
  if (state.ccNumber) {
    state.input = state.ccNumber.toString();
  }
  state.state = 'cc';
  state.msgs = [
    "Credit Card Number"
  , ""
  , "You card information will be stored SECURE and encrypted with Stripe.com"
  , "it WILL NOT BE SAVED on this computer or our servers"
  ];
  if (0 === state.purchaseAmount) {
    state.msgs.push("");
    state.msgs.push("-- $0 --");
    state.msgs.push("Your card WILL NOT be charged.");
    state.msgs.push("Your free domain WILL NOT be auto-renewed.");
    state.msgs.push("-- $0 --");
    state.msgs.push("");
    state.msgs.push("Your card will be used for verification only.");
  }
  state.prompt = 'Card Number      ';
  //state.prompt = 'American Express ';

  handleCcNumber(ws, state, cb);
}

function getCcExp(ws, state, cb) {
  if (state.ccExp) {
    state.input = state.ccExp.toString();
  }
  state.state = 'cc';
  state.msgs = [
    "Credit Card Expiration Date"
  , ""
  , "You card information will be stored SECURE and encrypted with Stripe.com"
  , "it WILL NOT BE SAVED on this computer or our servers"
  ];
  state.prompt = 'Expiration Date ';

  handleCcExp(ws, state, cb);
}

function getCcCvc(ws, state, cb) {
  if (state.ccCvc) {
    state.input = state.ccCvc.toString();
  }
  state.state = 'cc';
  state.msgs = [
    "Credit Card Verification Number (CVC)"
  , ""
  , "You card information will be stored SECURE and encrypted with Stripe.com"
  , "it WILL NOT BE SAVED on this computer or our servers"
  ];
  state.prompt = 'CVC ';

  handleCcCvc(ws, state, cb);
}

function getInputMailingAddress(ws, state, cb) {
  var msgs = [
    "The domain registry requires contact information."
  , ""
  , "This information will be made public in the international domain registry."
  , "This means that you will get spam snail mail (not from us) and also"
  , "phone calls from people (again, not us) in India claiming to be from Google - but they aren't."
  , ""
  , "For many domains it's okay to put an alternate address and phone number,"
  , "but YOUR EMAIL IS REQUIRED for various validations."
  , ""
  , "WARNING: Some domains, such as .me and .us, will cancel your registration"
  , "without refund if your mailing address is non-deliverable or not verifiable."
  ];
  state.msgs = msgs;
  state.input = state.rawAddr.firstName;
  state.hintAddress = {};
  state.hintAddresses = state.addresses.slice(0);
  state.hintPhones = state.phones.map(function (n) { return n.node; });
  state.hintEmails = state.emails.map(function (n) { return n.node; });

  function createInputCallback(ws, state, attr) {
    function inputCb(ws, state) {
      state.hints = require('./country-helper').findAddress(state, attr);

      search(ws, state);
    }
    inputCb(ws, state);
    return inputCb(ws, state);
  }

  function getCountry(ws, state, cb) {
    state.state = 'country';
    //state.msgs = [];
    state.prompt = 'Country (i.e. US, CA, RU): ';

    state.inputCallback = function inputCallback(ws, state) {
      var prompt = require('./country-helper').getCountryHelper(state);

      state.countryData = prompt;

      ws.cursorTo(0);
      ws.write(state.prompt);
      ws.write(prompt.autocomplete);
      //ws.moveCursor(-1 * r.hintlen, 0);
      ws.cursorTo(state.prompt.length + prompt.position);
    };

    handleInput(ws, state, function (err, result) {
      state.input = result;
      state.inputCallback(ws, state);
      state.input = '';
      state.inputCallback = null;

      // just the 2-character code
      cb(null, state.countryData.code);
    });

    // pre-fill suggestion
    state.inputCallback(ws, state);
  }

  //state.hints = [];
  state.inputCallback = createInputCallback(ws, state, 'firstName');
  state.autohint = true;
  getInput('First Name: ', /[A-Z][A-Za-z\.\-' ]*/, ws, state, function (err, first) {
    state.inputCallback = null;

    state.inputCallback = createInputCallback(ws, state, 'lastName');
    state.input = state.rawAddr.lastName;
    getInput('Last Name: ', /[A-Z][A-Za-z\.\-' ]*/, ws, state, function (err, last) {
      state.inputCallback = null;

      state.input = state.rawAddr.phone;
      state.hints = state.hintPhones;
      getInput('Phone: ', /[\+0-9\.\-]+/, ws, state, function (err, phone) {

        // TODO use email hinter
        state.hints = (state.username || state.email)
          && [state.email || state.username] || state.hintEmails;
        state.input = state.rawAddr.email;
        getInput('Email: ', /[^\@]+@[^\.]+\.[^\.]+/, ws, state, function (err, email) {

          state.inputCallback = createInputCallback(ws, state, 'streetAddress');
          state.input = state.rawAddr.streetAddress || state.rawAddr.line1;
          getInput('Street Address: ', /[a-z\.\-' ]+/i, ws, state, function (err, line1) {
            state.inputCallback = null;

            state.inputCallback = createInputCallback(ws, state, 'extendedAddress');
            state.input = state.rawAddr.extendedAddress || state.rawAddr.line2;
            //state.emptyOkay = true;
            getInput('Extended Address: ', /[a-z\.\-' ]*/i, ws, state, function (err, line2) {
              state.inputCallback = null;

              line2 = (line2 || '').trim();

              state.inputCallback = createInputCallback(ws, state, 'locality');
              //state.emptyOkay = false;
              state.input = state.rawAddr.locality;
              getInput('City: ', /[a-z\.\-' ]+/i, ws, state, function (err, locality) {
                state.inputCallback = null;

                state.inputCallback = createInputCallback(ws, state, 'region');
                state.input = state.rawAddr.region;
                getInput('State: ', /[a-z\.\-' ]+/i, ws, state, function (err, region) {
                  state.inputCallback = null;

                  state.inputCallback = createInputCallback(ws, state, 'postalCode');
                  state.input = state.rawAddr.postalCode;
                  getInput('Zip: ', /[0-9a-z\.\-' ]+/i, ws, state, function (err, postalCode) {
                    state.inputCallback = null;

                    state.input = state.rawAddr.countryCode;
                    getCountry(ws, state, function (err, countryCode) {
                      state.inputCallback = null;
                      state.autohint = false;

                      state.address = {
                        firstName: first
                      , lastName: last
                      , email: email
                      , phone: phone
                      , streetAddress: line1
                      , line1: line1
                      , extendedAddress: line2
                      , line2: line2
                      , locality: locality
                      , region: region
                      , postalCode: postalCode
                      , country: countryCode
                      , countryCode: countryCode
                      , node: [ first, last, line1, line2, locality, region
                              , postalCode, countryCode ].map(function (el) {
                                return (el || '').toLowerCase().trim();
                              }).join('\t')
                      };

                      cb(null, state.address);
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  });
}

function createCreditCard(ws, state, cb) {
  state.unmask = true;
  getCcNumber(ws, state, function (err, num) {
    getCcExp(ws, state, function (err, exp) {
      getCcCvc(ws, state, function (err, cvc) {
        state.unmask = true;
        getCcEmail(ws, state, function (err, email) {
          stripe.tokens.create({
            card: {
              number: num
            , exp_month: exp.substr(0, 2)
            , exp_year: '20' + exp.substr(2, 2)
            , cvc: cvc
            }
          }).then(function (token) {
            return A3.requests.cards.create(state.oauth3, state.session, {
              service: 'stripe'
            , email: email
            , token: token
            , priority: state.ccPriority
            , nick: state.ccNick
            , comment: state.ccComment
            });
          }).then(function (result) {
            cb(null, result);
          }, function (err) {
            cb(err);
          });
          /*
          cb(null, {
            type: state.ccRule.abbr
          , name: state.ccRule.name
          , number: num
          , cvc: cvc
          , month: exp.substr(0, 2)
          , year: '20' + exp.substr(2, 2)
          , email: email
          });
          */
        });
      });
    });
  });
}

CLI.getSecret = function (ws, state, cb) {
  state.state = 'secret';
  state.msgs = [
    "Now it's time to enter your passphrase"
  ];
  state.prompt = 'Enter your Passphrase ';

  handleSecret(ws, state, function (err, secret) {
    state.secret = secret;

    cb(null);
  });
};

CLI.createCredential = function (ws, state, cb) {
  // TODO standardize account creation
  A3.createCredential(state.oauth3, {
    appId: state.appId || state.oauth3.provider_uri
  , nodeType: 'email'
  , userId: state.username
  , secret: state.secret
  , mfa: state.totpKey && { totp: state.totpKey }
  //, tetantId: state.tenantId
  }).then(function (result) {
    // TODO save credential meta to file (and account later)
    //console.log('[oauth3-cli] Success createCredential');
    //console.log(result);
    state.userMeta = result;
      //console.log('[oauth3-cli] DEBUG');
      //console.log(result);
      //process.exit(1);
    cb(null);
  }, function (err) {
    console.error('[oauth3-cli] Error createCredential');
    console.error(err.stack);
    console.error(err.result);
    process.exit(1);
  });
};

CLI.createQr = function (ws, state, cb) {
  var url;

  state.totpRetry = state.totpRetry || 0;
  state._totpKey = state._totpKey || authenticator.generateKey();

  // TODO providerName
  url = authenticator.generateTotpUri(
    state._totpKey, state.username.replace(/@.*/, ''), state.oauth3.provider_uri, 'SHA1', 6, 30
  );
  // TODO minimal option to exclude these defaults
  url = url
    .replace(/issuer=([^&]*)&?/, '')
    .replace(/digits=6&?/, '')
    .replace(/algorithm=SHA1&?/, '')
    .replace(/period=30&?/, '')
    .replace(/(&|\?)$/, '')
    ;
  state.state = 'qr';
  state.msgs = [
    (state.totpRetry && ("[Take #" + (state.totpRetry + 1) + "] ") || '')
  + "Create New Account: Add Multi-Factor Authentication (2FA/MF1)"
  , ""
  ];

  qrcode.setErrorLevel('L'); // L: 7%, M: 15%, Q: 25%, H: 30%
  qrcode.generate(url, function (qr) {
    state.qr = qr;
    state.msgs.push('__RAW__');
  });

  state.msgs.push(url);
  state.msgs.push("");
  state.msgs.push("Download the Authy App at https://www.authy.com/app/");

  state.error = null;
  state.prompt = 'Enter 6-digit Authy Token: ';

  // TODO handle token as 000000 with delimeters '-', ' ', or '.'
  handleInput(ws, state, function (err, token) {
    if (!authenticator.verifyToken(state._totpKey, token)) {
      state.totpRetry += 1;
      CLI.createQr(ws, state, cb);
      return;
    }

    state.totpKey = state._totpKey;
    state.qr = null;
    state.state = '';
    cb(null, state.totpKey);
  });
};

STATE.loadProfiles = function (state) {
  if (state.configs) {
    return PromiseA.resolve(null);
  }

  return A.profile({
    rcpath: state.rcpath
  }).then(function (results) {
    if (results.errors.length) {
      state.msgs = results.errors.map(function (err) {
        return " * " + err.code + ": " + (err.message || err.toString());
      });
      state.msgs.unshift("ERROR: encountered errors while reading your config directory:");

      return PromiseA.reject(new Error("encountered errors"));
    }

    state.configs = results.configs;

    return null;
  });
};

STATE.loadDevice = function (state) {
  return A.device({
    rcpath: state.rcpath
  }).then(function (results) {
    state.device = results.device;

    return null;
  });
};

STATE.getProviderDirectives = function (state) {
  return A3.discover(state.providerUrl).then(function (results) {
    state.oauth3 = results;
    return null;
  });
};

STATE.getCredentialMeta = function (state) {
  return A3.getCredentialMeta(state.oauth3, state.username).then(function (results) {
    if (!results) {
      console.error('[Error]: Sanity Check Fail: no result');
      process.exit(1);
      return;
    }

    if (results.kdf) {
      state.userMeta = results;
      return null;
    }

    console.error('[Error]: Sanity Check Fail: unusual result');
    console.error(results);
    process.exit(1);
  }, function (err) {
    // TODO results.code
    if (/not exist/.test(err.message || err.description)) {
      state.userMeta = {};
      return null;
    }

    console.error('[Error]: Sanity Check Fail: unusual error');
    console.error(err);
    process.exit(1);
  });
};

STATE.loginCredential = function (state) {
  return A3.getProof(state.oauth3, state.userMeta, state.secret).then(function (proofstr) {
    return A3.requests.resourceOwnerPassword(state.oauth3, {
      id: state.username
    , secret: proofstr
    , scope: state.scope
    , totp: state.totpToken
    , appId: state.appId || state.providerUrl
    , clientAgreeTos: 'oauth3.org/tos/draft'
    , clientUri: 'oauth3.org'
    // , tenantId: 'oauth3.org' // TODO make server assume default tenant
    }).then(function (result) {
      state.secret = null;  // ditto
      proofstr = null;      // garbage collect the secret faster

      return result;
    }, function (error) {
      /*
      // TODO
      var err;
      err = new Error(result.error.message || result.error_description);
      err.code = result.error.code || result.error;
      err.uri = result.error.uri || result.error_uri;
      err.result = result;
      */

      return PromiseA.reject(error);
    }).then(function (result) {
      state.session = result;
      state.session.decoded = jwt.decode(state.session.accessToken);

      return STATE.testSession(state);
      //return null;
    }, function (err) {
      state.secret = null;  // ditto
      proofstr = null;      // garbage collect the secret faster
      console.error("[oauth3-cli] login Error:");
      console.error(err.stack || err);
      console.error(err.result);
      process.exit(1);
      /*
      state.userMeta = null;
      state.session = null;
      state.totpToken = null;
      */
      //return PromiseA.reject(err);
    });
  });
};

STATE.testSession = function (state) {
  return A3.requests.inspectToken(state.oauth3, state.session).then(function (/*result*/) {
    state.sessionTested = true;
  });
};

STATE.getAccounts = function (state) {
  // TODO force account refresh
  var decoded = state.session.decoded;
  var accounts = decoded.axs || decoded.acs
    || (decoded.acx && [ { idx: decoded.acx } ])
    || (decoded.acc && [ { id: decoded.acc } ])
    ;

  if (accounts) {
    state.accounts = accounts;
    return PromiseA.resolve(null);
  }

  if (!state.oauth3.accounts) {
    console.log("[oauth3-cli] handle profile NOT IMPLEMENTED");
    process.exit(1);
    /*
    if (!state.oauth3.profile) {
    }
    */
  }

  return A3.requests.accounts.all(state.oauth3, state.session).then(function (result) {
    state.accounts = result.accounts;
    return null;
  }, function (err) {
    console.error("[oauth3-cli] accounts Error:");
    console.error(err.stack || err);
    console.error(err.result);
    process.exit(1);
  });
};

STATE.getAccount = function (state) {
  if (!state.accounts.length) {
    return STATE.createAccount(state);
  }

  state.accounts.forEach(function (account) {
    if (account.idx === state.accountId
      || account.nick === state.accountId
      || account.comment === state.accountId
      || account.appScopedId === state.accountId) {
      state.account = account;
    }
  });

  // TODO show selection menu
  if (!state.account) {
    state.account = state.accounts[0];
  }

  state.session.acx = state.account.idx || state.account.appScopedId;

  return PromiseA.resolve(null);
};

STATE.getEcho = function (state) {
  state.echo = true;
  return A3.requests.echo(state.oauth3, state.session).then(function (/*result*/) {
    //console.log('ECHO result');
    //console.log(result);
    return null;
  });
};

STATE.makePurchase = function (state) {
  return A3.requests.domains.purchase(state.oauth3, state.session, {
    total: state.purchaseAmount
  , tip: state.tipAmount
  , domains: state.availableDomains.map(function (domain) {
      return {
        amount: Math.round(domain.usd.slice(1) * 100)
      , auth: domain.auth
      , sld: domain.sld
      , tld: domain.tld
      };
    })
  , currency: 'usd'
  , description: 'Purchase ' + state.availableDomains.length + ' domain(s).'
  , cardId: state.cards[0].id
  , customerId: state.cards[0].customer
  , email: state.ccEmail || state.username
  , addr: state.address
  }).then(function (results) {
    state.domainPurchases = results;
    return results;
  });
  /*
  A3.requests.purchase(state.oauth3, state.session, {
    amount: state.purchaseAmount
  , currency: 'usd'
  , description: 'Purchase example.com'
  , cardId: state.cards[0].id
  , customerId: state.cards[0].customer
  , email: state.ccEmail || state.username
  }).then(function (results) {
    console.log('[make purchase result]');
    console.log(results);
    process.exit(1);
    cb(null);
  });
   */
};

STATE.getExistingSession = function (state) {
  state.triedSession = true;
  return A.session(state).then(function (session) {
    var now;
    var then;

    if (!session) {
      return null;
    }

    now = Date.now();
    then = parseInt(session.session.decoded.exp, 10) * 1000;
    if (now < then) {
      state.accounts = session.accounts;
      state.userMeta = session.userMeta;
      state.session = session.session;

      return STATE.testSession(state);
    }

    return A3.requests.refreshToken(state.oauth3, {
      appId: state.appId || state.providerUrl
    , clientAgreeTos: 'oauth3.org/tos/draft'
    , clientUri: 'oauth3.org'
    //, scope: state.scope
    // , tenantId: 'oauth3.org' // TODO make server assume default tenant
    , refreshToken: session.session.refreshToken
    }).then(function (results) {
      results.refreshToken = results.refreshToken || session.session.refreshToken;

      state.accounts = null;
      state.account = null;

      state.session = results;
      state.session.decoded = jwt.decode(state.session.accessToken);

      return STATE.testSession(state);
      //return null;
    }, function (err) {
      console.error('[oauth3-cli] Refresh Token failure:');
      console.error(Object.keys(err));
      console.error(err);
      process.exit(1);
      return null;
    });
  });
};

STATE.createAccount = function (state) {
  // TODO if (!state.nick) { getNick(ws, state, function () { ... }); }
  return A3.requests.accounts.create(state.oauth3, state.session, {
    nick: state.nick
  , self: {
      comment: 'created by oauth3.org cli'
    }
  }).then(function (result) {
    state.session.accessToken = result.accessToken || result.access_token;
    state.session.decoded = jwt.decode(state.session.accessToken);

    state.accounts = null;
    state.account = result.account;

    return null;
  }, function (err) {
    console.error("[oauth3-cli] account Error:");
    console.error(err.stack || err);
    console.error(err.result);
    process.exit(1);
  });
};

function getDomainAvailability(state) {
  var r = state.domainSearch;
  var q = r.searchable;
  var tld  = r.tld;
  var sld = r.sld;

  // Reject queries against invalid domain name (empty secondary-level)
  if (!q || !sld) {
    return PromiseA.reject(new Error("don't submit non-domains please"));
  }

  if (state.dnSearchP[q]) {
    return state.dnSearchP[q];
  }

  state.dnSearchP[q] = A.searchDomains(sld, tld).then(function (dns) {
    var dn = dns[0];

    // TODO round up to the nearest 50¢ or 10¢?
    // var rounder = 50;
    // dn.amount = Math.ceil(dn.amount/rounder) * rounder;
    dn.usd = '$' + Math.round(dn.amount / 100);
    // TODO cache results
    dn.tld = tld;
    dn.sld = sld;
    dn.updatedAt = Date.now();
    dn.na = !dn.available;
    state.dnSearch[q] = dn;

    return dn;
  }, function (err) {
    var dn = {};
    // TODO cache results
    dn.available = false;
    dn.tld = tld;
    dn.sld = sld;
    dn.updatedAt = Date.now();
    dn.usd = 'ERR';
    dn.na = true;
    dn.error = err;
    state.dnSearch[q] = dn;

    console.error("getDomainAvailability Error");
    console.error(err);
    console.error(err.stack);
    process.exit(1);

    return dn;
  });

  return state.dnSearchP[q];
}

function showCart(state) {
  var price;
  var transfers = [];
  var cartable = [];
  var noncartable = [];

  if (!state.domains.length) {
    return '';
  }

  state.domains.forEach(function (domain) {
    if (domain.auth && domain.na) {
      transfers.push(domain);
    }
    else if (!domain.na) {
      cartable.push(domain);
    }
    else {
      noncartable.push(domain);
    }
  });

  //state.msgs.push("-- CART --");
  if (cartable.length) {
    //state.msgs.push("");
    state.msgs.push("New Domain Registrations:");
    state.msgs.push("    " + cartable.map(function (domain) {
      return colors.cyan(domain.sld + '.' + domain.tld + ' ' + domain.usd);
    }).join(', '));
  }
  if (transfers.length) {
    //state.msgs.push("");
    state.msgs.push("Domain Transfers:");
    state.msgs.push("    " + transfers.map(function (domain) {
      return colors.cyan(domain.sld + '.' + domain.tld + ' ' + domain.usd);
    }).join(', '));
  }
  if (noncartable.length) {
    //state.msgs.push("");
    state.msgs.push("Not Avaliable:");
    state.msgs.push("    " + noncartable.map(function (domain) {
      return colors.red(domain.sld + '.' + domain.tld + ' N/A');
    }).join(', '));
  }
  state.msgs.push("");
  price = state.domains.reduce(function (price, domain) {
    if (domain.available || domain.auth) {
      return price + parseFloat(domain.usd.slice(1), 10);
    }
    return price;
  }, 0);
  state.msgs.push("Domain Subtotal: $" + price);

  state.domainSubtotal = Math.round(price * 100);
  return price;
}

function nextDomain(ws, state, cb) {
  state.state = 'nextdomain';
  state.hints = [ 'yes', 'no' ];
  state.msgs = [];
  showCart(state);
  state.msgs.push("");
  state.msgs.push("Continue Shopping?");
  state.prompt = "Add another domain to cart? [y/N]: ";

  handleInput(ws, state, function (err, result) {
    if (/^\s*y/i.test(result)) {
      searchDomain(ws, state, cb);
      return;
    }
    if (!result || /^\s*n/i.test(result)) {
      cb(null, null);
      return;
    }

    nextDomain(ws, state, cb);
    return;
  });
}

function searchDomain(ws, state, cb) {
  var tld = state.tld && ('.' + state.tld) || '';
  if (state.sld) {
    state.input = state.sld + tld;
  }
  state.state = 'domain';
  state.msgs = [
    "Search for an Available Domain"
      , ""
      , "First 6-months Free domains ($1/yr):"
      , "    .daplie.me"
      , ""
      , "Cheap domains (under $15/yr):"
      , "    .abc .biz .click .com .info .link" // me, us non-private
      , "    .name .one .org .rocks .work .xyz"
      , ""
      , "Other cool domains (under $25/yr):"
      , "    .band .blue .cloud .club .dance .earth .family"
      , "    .live .network .ninja .pink .pro .red .studio .today"
      , ""
  ];
  showCart(state);
  state.prompt = 'Search Domains: ';
  //state.prompt = 'American Express ';

  state.domains = state.domains || [];
  state.dnSearch = state.dnSearch || {};
  state.dnSearchP = state.dnSearchP || {};
  state.tldsCacheDir = tldsCacheDir; // TODO is this needed?
  state.inputCallback = function inputCallback(ws, state) {
    var r = state.domainSearch = require('../lib/tld-hints').format(state);
    var p;

    if (r.searchable && !state.dnSearch[r.searchable]) {
      p = getDomainAvailability(state).then(function () {
        if ('domain' === state.state
            && r.searchable === state.domainSearch.searchable
           ) {
          if (inputCallback === state.inputCallback) {
            state.inputCallback(ws, state);
          } else {
            require('../lib/tld-hints').format(state);
          }
        }
      });
    } else {
      p = PromiseA.resolve();
    }

    ws.cursorTo(0);
    writePrompt(ws, state);
    ws.write(r.complete);
    //ws.moveCursor(-1 * r.hintlen, 0);
    ws.cursorTo(state.prompt.length + state.input.length);

    return p;
  };

  handleInput(ws, state, function (err, result) {
    state.input = result;
    state.inputCallback(ws, state);
    state.input = '';
    state.inputCallback = null;

    if (err) {
      console.error("DEBUG: searchDomain Error");
      console.error(err.stack || err);
      cb(err);
      return;
    }

    function retry() {
      if (0 === state.domains.filter(function (domain) {
        return domain.available || domain.auth;
      }).length) {
        searchDomain(ws, state, cb);
        return;
      }

      nextDomain(ws, state, cb);
    }

    var r = require('../lib/tld-hints').format({
      dnSearch: state.dnSearch
    , input: result
    , tldsCacheDir: tldsCacheDir
    });

    // TODO reject bad non-empty input from being ENTER-able
    if (!r.searchable) {
      retry();
      return;
    }
    if (!r.auth && r.na) {
      retry();
      return;
    }

    getDomainAvailability({
      dnSearch: state.dnSearch
    , dnSearchP: state.dnSearchP
    , domainSearch: r
    }).then(function (dn) {
      Object.keys(dn).forEach(function (k) {
        r[k] = dn[k];
      });
      if (r.available || r.auth) {
        state.availableDomains.push(r);
      }
      state.domains.push(r);
      retry();
    }, function (err) {
      console.error('[oauth3-cli] searchDomain Error');
      console.error(err.stack || err);
    });
  });

  // pre-fill suggestion
  state.inputCallback(ws, state);
}

function addDomainsToCart(ws, state, cb) {
  if (state.availableDomains.length) {
    if (state.checkoutReady) {
      cb(null, null);
      return;
    }

    nextDomain(ws, state, function (err) {
      state.checkoutReady = true;
      cb(err, null);
    });
    return;
  }

  searchDomain(ws, state, function (err) {
    state.checkoutReady = true;
    cb(err, null);
  });
}

function askTip(ws, state, cb) {
  state.state = 'asktip';
  state.hints = [];
  state.msgs = [];

  var price = showCart(state);

  state.msgs.push("");
  state.msgs.push("We appreciate tips!");
  state.msgs.push("Give an extra buck for R&D of Awesomeness?");
  state.prompt = "Tip Amount (i.e. 0, 1, 5, 10): $";

  handleInput(ws, state, function (err, result) {
    /*
    // Github Issue #3
    // (I'm not sure what this code was supposed to do)
    if (price < 1 && parseFloat(result) < 1) {
      askTip(ws, state, cb);
      return;
    }
    */

    if (!/^\s*\d+(\.\d\d)?\s*$/i.test(result)) {
      askTip(ws, state, cb);
      return;
    }

    state.tipped = true;
    state.tipDollars = parseFloat(result || 0, 10);
    state.tipAmount = Math.round(state.tipDollars * 100);
    cb(null, null);
  });
}

function confirmPurchase(ws, state, cb) {
  state.state = 'confirmdomains';
  state.hints = [ 'buy', 'cancel' ];
  state.msgs = [];

  var price = showCart(state);

  if (state.maxPurchaseAmount >= (state.domainSubtotal + state.tipAmount)) {
    state.purchaseReady = true;
    state.purchaseAmount = state.domainSubtotal + state.tipAmount;
    state.hints = [];
    cb(null, null);
    return;
  }

  state.msgs.push("");
  state.msgs.push("Purchase domains (with Tip) for " + colors.cyan('$' + (price + state.tipDollars)));
  state.prompt = "Type 'buy' or 'cancel': ";

  handleInput(ws, state, function (err, result) {
    if (/^\s*buy\s*$/i.test(result)) {
      state.purchaseReady = true;
      state.purchaseAmount = state.domainSubtotal + state.tipAmount;
      cb(null, null);
      return;
    }
    else if (/^\s*cancel\s*$/i.test(result)) {
      console.log("Cancel purchase");
      process.exit(0);
      return;
    }
    else {
      confirmPurchase(ws, state, cb);
      return;
    }
  });
}

function getCards(ws, state, cb) {
  state.card = true;
  A3.requests.cards.all(state.oauth3, state.session).then(function (results) {

    if (results.length) {
      state.cards = results;
      cb(null);
      return;
    }

    createCreditCard(ws, state, function (err, card) {
      if (err || card.error) {
        console.error("getCards Error");
        console.error(err || card);
        process.exit(1);
        return;
      }

      state.cards = [ card ];
      cb(null);
    });
  });
}

function getMailingAddress(ws, state) {
  return A3.requests.addresses.all(state.oauth3, state.session).then(function (results) {
    state.addresses = results;

    return A3.requests.emails.all(state.oauth3, state.session).then(function (results) {
      state.emails = results;

      return A3.requests.phones.all(state.oauth3, state.session).then(function (results) {
        // TODO format phone
        state.phones = results;

        return PromiseA.promisify(getInputMailingAddress)(ws, state);
      });
    });
  });
}

function getOrCreateMailingAddress(ws, state) {
  return getMailingAddress(ws, state).then(function (address) {
    var ps = [];
    var phone = address.phone;
    var email = address.email;

    function log(result) {
      console.log(result);
    }
    function logErr(err) {
      console.error(err.stack || err);
    }

    if (!state.addresses.some(function (addr) {
      if (addr.node === address.node) {
        return true;
      }
    })) {
      address = JSON.parse(JSON.stringify(address));
      delete address.phone;
      delete address.email;
      delete address.line1;
      delete address.line2;
      delete address.country;
      //delete address.node;
      state.addresses.push(address);
      ps.push(A3.requests.addresses.create(
        state.oauth3, state.session, address
      ).then(log, logErr));
    }

    // TODO format phone
    if (!state.phones.some(function (node) {
      if (phone === node.node) {
        return true;
      }
    })) {
      ps.push(A3.requests.phones.create(
        state.oauth3, state.session, { node: phone }
      ).then(log, logErr));
    }

    if (!state.emails.some(function (node) {
      if (email === node.node) {
        return true;
      }
    })) {
      ps.push(A3.requests.emails.create(
        state.oauth3, state.session, { node: email }
      ).then(log, logErr));
    }

    return PromiseA.all(ps);
  });
}

function loginHelper(ws, state, cb) {
  function loopit(err) {
    if (err && (/Error/.test(err.name) || (err.code && err.description))) {
      reCompute(ws, state);
      console.error("loginHelper Error");
      console.error(err);
      process.exit(1);
      return;
    }

    loginHelper(ws, state, cb);
  }

  if (!state.configs) {
    STATE.loadProfiles(state).then(loopit);
  }
  else if (!state.device) {
    STATE.loadDevice(state).then(loopit);
  }
  else if (!state.providerUrl) {
    CLI.getProviderName(ws, state, loopit);
  }
  else if (!state.oauth3) {
    STATE.getProviderDirectives(state).then(loopit);
  }
  else if (!state.username) {
    CLI.getId(ws, state, loopit);
  }
  else if (!state.triedSession) {
    STATE.getExistingSession(state).then(loopit);
  }
  // TODO load profile by provider / username
  else if (!state.userMeta) {
    STATE.getCredentialMeta(state).then(loopit);
  }
  else if (!state.userMeta.kdf) {
    if (!state.totpKey) {
      CLI.createQr(ws, state, loopit);
    }
    else if (!state.secret) {
      CLI.createSecret(ws, state, loopit);
    }
    else {
      CLI.createCredential(ws, state, loopit);
    }
  }
  else if (!state.session) {
    if (!state.secret) {
      CLI.getSecret(ws, state, loopit);
    }
    else if (state.userMeta.totpEnabledAt && !state.totpToken && false !== state.totpToken) {
      CLI.getToken(ws, state, loopit);
    }
    else {
      STATE.loginCredential(state).then(loopit);
    }
  }
  else if (!(state.accounts || state.profile)) {
    STATE.getAccounts(state).then(loopit);
  }
  else if (state.accounts && !state.account) {
    STATE.getAccount(state).then(loopit);
  }
  else if (!state.echo) {
    STATE.getEcho(state).then(loopit);
  }
  else {
    A.saveSession(state).then(function () {
      cb(null, state);
    });
  }
}

function autoLogin(state) {
  // state.{providerUrl,username,accountId}
  return A.getDefaults(state).then(function () {
    var err;
    if (!state.providerUrl || !state.username || !state.accountId) {
      state.setDefault = true;
      err = new Error('not logged in');
      err.code = 'E_NO_AUTH';
      return PromiseA.reject(err);
    }

    // state.configs
    return STATE.loadProfiles(state);
  }).then(function () {
    // state.device
    return STATE.loadDevice(state);
  }).then(function () {
    // state.oauth3
    return STATE.getProviderDirectives(state);
  }).then(function () {
    // state.triedSession
    // state.session
    return STATE.getExistingSession(state);
  }).then(function () {
    // state.accounts
    return STATE.getAccounts(state);
  }).then(function () {
    // state.account
    return STATE.getAccount(state);
  }).then(function () {
    return state;
    /*
    return {
      oauth3: state.oauth3
    , session: state.session
    , account: state.account
    , device: state.device
    };
    */
  });
}

STATE.getPurchasedDomains = function (state) {
  return A3.requests.domains.all(state.oauth3, state.session).then(function (regs) {
    state.purchasedDomains = regs.registrations;

    return regs.registrations;
  });
};

/*
function getMyDomains(ws, state) {
  function loopit() {
    getMyDomain(ws, state);
  }

  if (!state.purchasedDomains) {
    getPurchasedDomains(ws, state, loopit);
  }
}
*/

function getDomain(ws, state, cb) {
  function loopit() {
    getDomain(ws, state, cb);
  }

  if (!state.checkoutReady) {
    addDomainsToCart(ws, state, loopit);
  }
  else if (!state.tipped) {
    askTip(ws, state, loopit);
  }
  else if (!state.purchaseReady) {
    confirmPurchase(ws, state, loopit);
  }
  else if (!state.cards) {
    getCards(ws, state, loopit);
  }
  else if (!state.address) {
    getOrCreateMailingAddress(ws, state).then(loopit);
  }
  else {
    STATE.makePurchase(state).then(function () {
      cb(null);
    }, cb);
  }
}

function init(state) {
  var homedir = require('homedir')();

  state.homedir = homedir;
  state.rcpath = path.join(state.homedir, '.oauth3');
  state.tldsCacheDir = tldsCacheDir;
  state.hints = [];

  if (!state.state) {
    state.state = 'loading';
  }

  if (!state.msgs) {
    state.msgs = ['...'];
  }
  if (!state.codes) {
    state.codes = '';
  }
  if (!state.debugs) {
    state.debugs = [];
  }
}

function loginInit(state, options) {
  state.username = options.id;
  state.providerUrl = options.provider;
  state.totpKey = options.totp;
  state.secret = options.secret;
  state.scope = options.scope;
  state.appId = options.client;

  if ('false' === state.totpKey) {
    state.totpKey = false;
    state.totpToken = false;
  }

  if (state.totpKey) {
    state.totpToken = authenticator.generateToken(state.totpKey);
    if (!state.totpToken) {
      throw new Error("invalid totp key");
    }
  }
}

function addressInit(state, options) {
  state.rawAddr = {};
  state.rawAddr.firstName = (options['first-name'] || '').toString();
  state.rawAddr.lastName = (options['last-name'] || '').toString();
  state.rawAddr.email = (options.email || '').toString();
  state.rawAddr.phone = (options.phone || '').toString();
  state.rawAddr.line1 = (options.line1 || '').toString();
  state.rawAddr.line2 = (options.line2 || '').toString();
  if (state.rawAddr.line1 && !state.rawAddr.line2) {
    state.rawAddr.line2 = ' ';
  }
  state.rawAddr.locality = (options.locality || '').toString();
  state.rawAddr.region = (options.region || '').toString();
  state.rawAddr.postalCode = (options['postal-code'] || '').toString();
  state.rawAddr.countryCode = (options['country-code'] || '').toString();
}

function initDomainsAsync(state, options) {
  return require('../lib/api/tlds').getTldsAsync({ cacheDir: tldsCacheDir }).then(function () {
    // TODO max price
    state.maxPurchaseAmount = Math.round(parseFloat(options['max-purchase-price'], 10) * 100) || 0;

    if (options.tip) {
      state.tipDollars = parseFloat(options.tip, 10);
      if (!isNaN(state.tipDollars)) {
        state.tipAmount = Math.round(state.tipDollars * 100);
        state.tipped = true;
      }
    }

    state.dnSearch = {};
    state.dnSearchP = {};
    state.domains = [];
    state.availableDomains = [];
    state.rawDomains = (options.domains||'').split(',').map(function (domain) {
      return require('../lib/tld-hints').format({
        dnSearch: state.dnSearch
      , input: domain
      , tldsCacheDir: tldsCacheDir
      });
    }).filter(function (domain) {
      return domain.searchable;
    });

    return PromiseA.all(state.rawDomains.map(function (domain) {
      if (!domain.searchable) {
        domain.valid = false;
        domain.na = true;
        domain.usd = 'ERR';
        return domain;
      }

      return getDomainAvailability({
        dnSearch: state.dnSearch
      , dnSearchP: state.dnSearchP
      , domainSearch: domain
      }).then(function (dn) {
        Object.keys(dn).forEach(function (k) {
          domain[k] = dn[k];
        });
        if (domain.available || domain.auth) {
          state.availableDomains.push(domain);
        }
        state.domains.push(domain);
      });
    })).then(function () {
      if (state.availableDomains.length && state.availableDomains.length === state.domains.length) {
        state.checkoutReady = true;
      }

      //getDomain();
    });
  });
}

function ccInit(state, options) {
  state.ccNumber = options['cc-number'] || options.ccNumber || options.cardNumber;
  state.ccExp = options['cc-exp'] || options.ccExp || options.cardExpiration;
  state.ccCvc = options['cc-cvc'] || options.ccCvc || options.cardCvc;
  state.ccEmail = options['cc-email'] || options.ccEmail || options.cardEmail;
  state.ccNick = options['cc-nick'] || options.ccNick || options.cardNick;
  state.ccComment = options['cc-comment'] || options.ccComment || options.cardComment;
  state.ccPriority = options['cc-priority'] || options.ccPriority || options.cardPriority;
}

function wsInit(ws, state) {
  // var ws = process.stdout;
  if (!ws._resizer) {
    ws._pause = function () {
      ws._paused = true;
    };
    ws._resume = function () {
      ws._paused = false;
    };
    ws._resizer = function () {
      if (!ws._paused) {
        reCompute(ws, state);
      }
    };
    ws.on('resize', ws._resizer);
  }
  ws._resume();
  reCompute(ws, state);

  return ws;
}

function getDomainPartsAsync(domainname) {
  return require('../lib/api/tlds').getTldsAsync({ cacheDir: tldsCacheDir }).then(function (domains) {
    var opts;

    // XXX
    // TODO make own function
    // XXX
    domains.tlds.sort(function (a, b) {
      var numDotsA = (a.tld.match(/\./g)||'').length;
      var numDotsB = (b.tld.match(/\./g)||'').length;
      var diffDots = numDotsA - numDotsB;

      if (diffDots) {
        return diffDots;
      }

      return a.tld.length - b.tld.length;
    });

    //opts = { sub: options.sub, sld: options.sld, tld: options.tld, device: state.device.hostname };
    opts = { sub: '', sld: '', tld: '', };
    // TODO find a better better solution
    domains.tlds.push({ tld: 'dj' });
    domains.tlds.sort(function (a, b) {
      return b.tld.length - a.tld.length;
    }).some(function (tld) {
      var re = new RegExp('\\.' + tld.tld.replace(/\./g, '\\.') + '$');
      var parts;

      if (re.test(domainname)) {
        opts.tld = tld.tld;
        parts = domainname.replace('.' + tld.tld, '').split(/\./g);
        opts.sld = parts.pop();
        opts.sub = parts.join('.');
        return true;
      }
    });

    if (!opts.tld) {
      return PromiseA.reject(new Error("tld '" + opts.tld + "' Sorry, We don't have the TLD you entered. Please try another one or email domains@daplie.com and request one."));
    }

    return opts;
  });
}

//
// Exports
//

var Oauth3 = module.exports;

Oauth3.manualLogin = function (options) {
  options = options || {};
  //var readline = require('readline');
  //var rl = readline.createInterface(process.stdin, process.stdout);
  var state = {};
  init(state);
  loginInit(state, options);
  var ws = wsInit(process.stdout, state, options);

  return PromiseA.promisify(loginHelper)(ws, state).then(function () {
    return state;
  });
};

Oauth3.autoLogin = function (options) {
  var state = {};
  options = options || {};
  init(state);
  loginInit(state, options);

  return autoLogin(state);
};

Oauth3.login = function (options) {
  return Oauth3.autoLogin(options).then(function (state) {
    if (!state) {
      return Oauth3.manualLogin(options);
    }
    return state;
  }, function (err) {
    if ('E_NO_AUTH' === err.code) {
      return Oauth3.manualLogin(options);
    }

    console.error("login Error");
    console.error(err.stack);
    process.exit(1);

    //return Oauth3.manualLogin(options);
  }).then(function (state) {
    return state;
  });
};

var Accounts = Oauth3.Accounts = {};
Accounts.list = function (options) {
  return Oauth3.login(options).then(function (state) {
    return A3.requests.accounts.all(state.oauth3, state.session);
  });
};

var Addresses = Oauth3.Addresses = {};
Addresses.list = function (options) {
  return Oauth3.login(options).then(function (state) {
    return A3.requests.addresses.all(state.oauth3, state.session);
  });
};
Addresses.create = function (options) {
  return Oauth3.login(options).then(function (state) {
    ccInit(state, options);
    addressInit(state, options);
    return getOrCreateMailingAddress(wsInit(process.stdout, state), state).then(function (results) {
      console.log('results:', results);
    });
  });
};

var Cards = Oauth3.Cards = {};
Cards.list = function (options) {
  return Oauth3.login(options).then(function (state) {
    return A3.requests.cards.all(state.oauth3, state.session);
  });
};
Cards.add = function (options) {
  return Oauth3.login(options).then(function (state) {
    var ccc = PromiseA.promisify(createCreditCard);
    ccInit(state, options);
    return ccc(wsInit(process.stdout, state), state);
  });
};
Cards.update = function (options) {
  return Oauth3.login(options).then(function (state) {
    return A3.requests.cards.update(state.oauth3, state.session, {
      last4: options.last4
    , brand: options.brand
    , comment: options.comment
    , email: options.email
    , exp: options.exp
    , nick: options.nick
    , priority: options.priority
    , default: options.default
    });
  });
};
Cards.remove = function (options) {
  return Oauth3.login(options).then(function (state) {
    return A3.requests.cards.remove(state.oauth3, state.session, {
      last4: options.last4
    , brand: options.brand
    , exp: options.exp
    });
  });
};

var Domains = Oauth3.Domains = {};
Domains.all = function (options) {
  return Oauth3.login(options).then(function (state) {
    return STATE.getPurchasedDomains(state);
  });
};

Domains.purchase = function (options) {
  options = options || {};
  return Oauth3.login(options).then(function (state) {
    ccInit(state, options);
    addressInit(state, options);
    return initDomainsAsync(state, options).then(function () {
      return PromiseA.promisify(getDomain)(wsInit(process.stdout, state), state).then(function () {
        return state.domainPurchases;
      });
    });
  });
};

var Dns = Oauth3.Dns = {};
Dns.all = function (options) {
  return Oauth3.login(options).then(function (state) {
    return A3.requests.dns.all(state.oauth3, state.session);
  });
};

Dns.get = function (options) {
  return Oauth3.login(options).then(function (state) {
    var domainname = options.domain || options.name || options.domainname;

    return getDomainPartsAsync(domainname).then(function (parts) {
      return A3.requests.dns.get(state.oauth3, state.session, parts);
    });
  });
};

Dns.set = function (options) {
  var domainname = options.domain || options.name || options.domainname;

  /*
  var p;

  if (options.token) {
    p = PromiseA.resolve({ token: options.token });
  } else {
    p = Oauth3.Devices.token(options);
  }

  return p.then(function (result) {
  */

  return getDomainPartsAsync(domainname).then(function (domainparts) {

    options.sub = domainparts.sub;
    options.sld = domainparts.sld;
    options.tld = domainparts.tld;

    return Oauth3.login(options).then(function (state) {
      var opts2 = {
        name: domainname //(opts.sub ? opts.sub + '.' : '') + opts.sld + '.' + opts.tld
      //, device: options.device
      , type: options.type || 'A'
      , value: options.answer || options.value
      //, token: result.token
      , ttl: options.ttl || 600
      , priority: 10
      , sub: domainparts.sub
      , sld: domainparts.sld
      , tld: domainparts.tld
      };

      return A3.requests.dns.set(state.oauth3, state.session, opts2);
    });
  });
};

Dns.destroy = function (options) {
  var domainname = options.domain || options.name || options.domainname;

  return getDomainPartsAsync(domainname).then(function (domainparts) {

    options.sub = domainparts.sub || '.';
    options.sld = domainparts.sld;
    options.tld = domainparts.tld;

    return Oauth3.login(options).then(function (state) {
      var opts2 = {
        name: domainname //(opts.sub ? opts.sub + '.' : '') + opts.sld + '.' + opts.tld
      , type: options.type || 'A'
      , value: options.answer || options.value
      , sub: options.sub || '.'
      , sld: options.sld
      , tld: options.tld
      };

      return A3.requests.dns.destroy(state.oauth3, state.session, opts2);
    });
  });
};

var Devices = Oauth3.Devices = {};
Devices.token = function (options) {
  options = options || {};

  return Oauth3.login(options).then(function (state) {
    // TODO cache token on disk
    return A3.requests.devices.token(state.oauth3, state.session, options);
  });
};

Devices.attach = function (options) {
  options.device = options.devicename || options.device || options.name;
  options.domain = options.domainname || options.domainname || options.name;
  // device, domain, update, ttl, priority, addresses

  return getDomainPartsAsync(options.domain).then(function (domainparts) {
    options.sub = domainparts.sub;
    options.sld = domainparts.sld;
    options.tld = domainparts.tld;

    return Oauth3.login(options).then(function (state) {
      return A3.requests.devices.attach(state.oauth3, state.session, options);
    });
  });
};

Devices.detach = function (options) {
  // options = { addresses, devicename }
  options.devicename = options.devicename || options.device || options.name;
  options.domain = options.domain || options.name;

  return getDomainPartsAsync(options.domain).then(function (domainparts) {
    options.sub = domainparts.sub;
    options.sld = domainparts.sld;
    options.tld = domainparts.tld;

    return Oauth3.login(options).then(function (state) {
      return A3.requests.devices.detach(state.oauth3, state.session, options);
    });
  });
};

Devices.all = function (options) {
  return Oauth3.login(options).then(function (state) {
    return A3.requests.devices.all(state.oauth3, state.session);
  });
};

Devices.set = function (options) {
  // options = { addresses, devicename }
  options.devicename = options.devicename || options.device || options.name;
  return Oauth3.login(options).then(function (state) {
    var errs = [];

    if (!Array.isArray(options.addresses)) {
      options.addresses = options.addresses.split(',').map(function (address) {
        var result = {
          value: address
        , type: A3.dnsValueType(address)
        };

        return result;
      });
    }

    options.addresses.forEach(function (address) {
      if (-1 === [ 'A', 'AAAA' ].indexOf(address.type)) {
        errs.push("'" + address.value + "' is not a valid IPv4 or IPv6 address");
        return true;
      }
    });

    if (errs.length) {
      console.log("");
      errs.forEach(function (msg) {
        console.error(msg);
      });
      console.log("");
      process.exit(1);
    }

    return A3.requests.devices.set(state.oauth3, state.session, options);
  });
};

Devices.destroy = function (options) {
  // options = { addresses, devicename }
  options.devicename = options.devicename || options.device || options.name;
  if ('delete' !== options.confirm) {
    console.error("You must must specify --confirm delete to remove a device from all domains");
    process.exit(1);
    return;
  }

  return Oauth3.login(options).then(function (state) {
    return A3.requests.devices.destroy(state.oauth3, state.session, options);
  });
};

var Glue = Oauth3.Glue = {};
Glue.all = function (options) {
  return Oauth3.login(options).then(function (state) {
    return A3.requests.glue.all(state.oauth3, state.session);
  });
};
Glue.set = function (options) {
  var p;

  if (options.defaults) {
    p = getDomainPartsAsync(options.name).then(function (o) {
      return [
        { tld: o.tld
        , sld: o.sld
        , sub: 'ns1'
        , ip: '192.241.238.7'
        }
      , { tld: o.tld
        , sld: o.sld
        , sub: 'ns2'
        , ip: '66.172.33.29'
        }
      ];
    });
  }
  else {
    p = getDomainPartsAsync(options.name).then(function (o) {
      o.ip = options.address;
      return PromiseA.resolve([ o ]);
    });
  }

  return Oauth3.login(options).then(function (state) {
    return p.then(function (records) {
      return PromiseA.all(records.map(function (r) {
        return A3.requests.glue.set(state.oauth3, state.session, r);
      }));
    });
  });
};

var Ns = Oauth3.Ns = {};
Ns.get = function (options) {
  var dns = PromiseA.promisifyAll(require('dns'));

  return dns.resolveNsAsync(options.name);
};
Ns.set = function (options) {
  if (options.defaults) {
    options.nameservers = [ 'ns1.redirect-www.org', 'ns2.redirect-www.org' ];
  }
  if ('string' === typeof options.nameservers) {
    options.nameservers = options.nameservers.split(',');
  }
  options.domainname = options.domainame || options.name;

  return getDomainPartsAsync(options.name).then(function (o) {
    return Oauth3.login(options).then(function (state) {
      options.tld = o.tld;
      options.sld = o.sld;
      return A3.requests.ns.set(state.oauth3, state.session, options);
    });
  }).then(function () {
    return { name: options.name, nameservers: options.nameservers };
  });
};
