#!/usr/bin/env node

import os from 'os';
import { exec } from 'child_process';

// Get the message from command line arguments
const message = process.argv[2] || 'Task complete';

// Cross-platform voice notification
if (os.platform() === 'darwin') {
  exec(`say '${message}'`);
} else if (os.platform() === 'win32') {
  exec(`powershell -Command "Add-Type -AssemblyName System.Speech; $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer; $synth.Speak('${message}')"`);
} else {
  // Linux/Unix fallback
  exec(`which espeak > /dev/null 2>&1 && espeak '${message}' || echo '${message}' | festival --tts || echo 'Voice notification: ${message}'`);
}