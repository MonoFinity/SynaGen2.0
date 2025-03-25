const express = require('express');
const { PythonShell } = require('python-shell');
const fileUpload = require('express-fileupload');
const path = require('path');
const fs = require('fs');
const app = express();
const port = 3005;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(fileUpload({
  createParentPath: true,
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB max file size for large voice samples
}));

// Serve static files from public directory
app.use('/public', express.static(path.join(__dirname, 'public')));

// Track GPU/system info
let systemInfo = {
  gpuAvailable: false,
  gpuName: "Unknown",
  cudaVersion: "N/A",
  modelLoaded: false,
  modelPath: "Not loaded",
  voices: {}
};

// Initialize Python environment and check GPU
const initPythonEnvironment = async () => {
  try {
    console.log("Checking GPU and system configuration...");
    const result = await new Promise((resolve, reject) => {
      PythonShell.run('spark_bridge.py', {
        mode: 'text',
        pythonPath: 'python',
        args: ['--action', 'list_voices']
      }).then(output => {
        // Process the output to get system info
        let systemData = { gpuAvailable: false, voices: {} };
        
        // Log the raw output for debugging
        console.log("Raw Python output:", output);
        
        for (const line of output) {
          try {
            const data = JSON.parse(line);
            
            if (data.status === 'cuda') {
              systemData.gpuAvailable = true;
              systemData.gpuName = data.device;
              systemData.cudaVersion = data.version;
            } else if (data.status === 'init' && data.message.includes('successfully')) {
              systemData.modelLoaded = true;
            } else if (data.voices) {
              systemData.voices = data.voices;
            }
          } catch (e) {
            // Skip lines that aren't valid JSON
            console.log("Non-JSON line:", line);
          }
        }
        
        resolve(systemData);
      }).catch(err => {
        console.error("Error checking system:", err);
        reject(err);
      });
    });
    
    // Update system info
    systemInfo = { ...systemInfo, ...result };
    console.log("System configuration:", systemInfo);
    
    return systemInfo;
  } catch (error) {
    console.error("Failed to initialize Python environment:", error);
    return systemInfo;
  }
};

// Function to find an available port
const findAvailablePort = async (startPort) => {
  const net = require('net');
  
  const isPortAvailable = (port) => {
    return new Promise((resolve) => {
      const server = net.createServer();
      
      server.once('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          console.log(`Port ${port} is in use, trying next port`);
          resolve(false);
        } else {
          console.error('Error checking port:', err);
          resolve(false);
        }
      });
      
      server.once('listening', () => {
        server.close();
        resolve(true);
      });
      
      server.listen(port);
    });
  };
  
  let currentPort = startPort;
  const maxPort = startPort + 20; // Try up to 20 ports
  
  while (currentPort < maxPort) {
    if (await isPortAvailable(currentPort)) {
      return currentPort;
    }
    currentPort++;
  }
  
  throw new Error(`Could not find an available port between ${startPort} and ${maxPort-1}`);
};

// Start the server with error handling
const startServer = async () => {
  try {
    // First initialize the Python environment
    await initPythonEnvironment();
    
    // Find an available port
    const availablePort = await findAvailablePort(port);
    
    // Start the server on the available port
    const server = app.listen(availablePort, () => {
      console.log(`Server started on port ${availablePort}`);
      console.log(`Visit http://localhost:${availablePort} in your browser`);
      
      if (systemInfo.gpuAvailable) {
        console.log(`Using GPU: ${systemInfo.gpuName} with CUDA ${systemInfo.cudaVersion}`);
      } else {
        console.log("GPU not available. Using CPU for processing.");
      }
    });
    
    // Handle server errors
    server.on('error', (error) => {
      console.error('Server error:', error);
      if (error.code === 'EADDRINUSE') {
        console.error(`Port ${availablePort} is already in use. Please try a different port.`);
        process.exit(1);
      }
    });
    
    return server;
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Serve a simple HTML page with SynaGen 2.0 in dark mode
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>SynaGen 2.0</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background-color: #121212;
            color: #e0e0e0;
          }
          .container {
            text-align: center;
            padding: 2rem;
            border-radius: 10px;
            background-color: #1e1e1e;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
          }
          h1 {
            color: #ffffff;
          }
          .btn {
            background-color: #4285f4;
            color: white;
            border: none;
            padding: 12px 24px;
            margin-top: 20px;
            border-radius: 5px;
            font-size: 16px;
            cursor: pointer;
            transition: background-color 0.3s;
          }
          .btn:hover {
            background-color: #3367d6;
          }
          .system-info {
            margin-top: 20px;
            font-size: 14px;
            color: #aaa;
          }
          .gpu-available {
            color: #4caf50;
          }
          .gpu-unavailable {
            color: #f44336;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>SynaGen 2.0</h1>
          <p>This is a simple server running on localhost:${req.socket.localPort}</p>
          <a href="/spark-tts"><button class="btn">Spark-TTS</button></a>
          
          <div class="system-info">
            <p>System Info: 
              <span class="${systemInfo.gpuAvailable ? 'gpu-available' : 'gpu-unavailable'}">
                ${systemInfo.gpuAvailable ? 'GPU: ' + systemInfo.gpuName : 'CPU Mode'}
              </span>
            </p>
          </div>
        </div>
      </body>
    </html>
  `);
});

// Add a new route for Spark-TTS demo page
app.get('/spark-tts', async (req, res) => {
  // Ensure we have the latest voice list
  try {
    await refreshVoiceList();
  } catch (error) {
    console.error("Error refreshing voice list:", error);
  }

  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Spark-TTS Demo</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 20px;
            background-color: #121212;
            color: #e0e0e0;
          }
          .container {
            max-width: 800px;
            margin: 0 auto;
            padding: 2rem;
            border-radius: 10px;
            background-color: #1e1e1e;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
          }
          h1, h2 {
            color: #ffffff;
          }
          a {
            color: #4285f4;
            text-decoration: none;
          }
          a:hover {
            text-decoration: underline;
          }
          .btn {
            background-color: #4285f4;
            color: white;
            border: none;
            padding: 10px 20px;
            margin-top: 20px;
            border-radius: 5px;
            font-size: 16px;
            cursor: pointer;
            transition: background-color 0.3s;
            display: inline-block;
          }
          .btn:hover {
            background-color: #3367d6;
          }
          .btn:disabled {
            background-color: #4285f455;
            cursor: not-allowed;
          }
          .demo-section {
            margin-top: 30px;
          }
          .feature-list {
            list-style-type: none;
            padding-left: 0;
          }
          .feature-list li {
            margin-bottom: 10px;
            padding-left: 20px;
            position: relative;
          }
          .feature-list li:before {
            content: "•";
            position: absolute;
            left: 0;
            color: #4285f4;
          }
          .back-link {
            display: inline-block;
            margin-top: 20px;
          }
          .tts-form {
            margin-top: 20px;
            background-color: #2a2a2a;
            padding: 20px;
            border-radius: 8px;
          }
          .form-group {
            margin-bottom: 15px;
          }
          label {
            display: block;
            margin-bottom: 5px;
            font-weight: bold;
          }
          input[type="text"], textarea {
            width: 100%;
            padding: 10px;
            border-radius: 5px;
            border: 1px solid #444;
            background-color: #333;
            color: #e0e0e0;
            font-size: 16px;
          }
          textarea {
            min-height: 100px;
            resize: vertical;
          }
          .audio-player {
            margin-top: 20px;
            width: 100%;
            display: none;
          }
          .status-area {
            margin-top: 15px;
            padding: 10px;
            border-radius: 5px;
            background-color: #2a2a2a;
            display: none;
          }
          .file-input-wrapper {
            position: relative;
            overflow: hidden;
            display: inline-block;
          }
          .file-input-wrapper input[type=file] {
            font-size: 100px;
            position: absolute;
            left: 0;
            top: 0;
            opacity: 0;
            cursor: pointer;
          }
          .file-input-wrapper .btn {
            display: inline-block;
            margin-right: 10px;
          }
          .file-name {
            display: inline-block;
            margin-left: 10px;
            font-size: 14px;
          }
          .system-badge {
            display: inline-block;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: bold;
            margin-left: 10px;
            vertical-align: middle;
          }
          .gpu-badge {
            background-color: #4caf50;
            color: white;
          }
          .cpu-badge {
            background-color: #f44336;
            color: white;
          }
          .model-info {
            font-size: 14px;
            color: #aaa;
            margin-top: 5px;
          }
          .error-log {
            margin-top: 10px;
            padding: 10px;
            background-color: #2a0000;
            border-radius: 5px;
            color: #ff8080;
            font-family: monospace;
            white-space: pre-wrap;
            max-height: 200px;
            overflow-y: auto;
            display: none;
          }
          .voice-selector {
            margin-top: 15px;
            width: 100%;
            padding: 10px;
            border-radius: 5px;
            border: 1px solid #444;
            background-color: #333;
            color: #e0e0e0;
            font-size: 16px;
          }
          .voice-option-group {
            margin-top: 10px;
            margin-bottom: 20px;
          }
          .separator {
            border-top: 1px solid #444;
            margin: 15px 0;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Spark-TTS Demo
            <span class="system-badge ${systemInfo.gpuAvailable ? 'gpu-badge' : 'cpu-badge'}">
              ${systemInfo.gpuAvailable ? 'GPU' : 'CPU'}
            </span>
          </h1>
          <p class="model-info">Using ${Object.keys(systemInfo.voices || {}).length} available voices</p>
          <p>This is a demonstration of the Spark-TTS project, an advanced text-to-speech system that uses large language models for natural-sounding voice synthesis.</p>
          
          <div class="demo-section">
            <h2>Key Features</h2>
            <ul class="feature-list">
              <li><strong>Simplicity and Efficiency:</strong> Built on Qwen2.5, eliminating the need for additional generation models</li>
              <li><strong>High-Quality Voice Cloning:</strong> Supports zero-shot voice cloning</li>
              <li><strong>Bilingual Support:</strong> Supports both Chinese and English</li>
              <li><strong>Controllable Speech Generation:</strong> Create virtual speakers by adjusting parameters</li>
            </ul>
          </div>

          <div class="demo-section">
            <h2>Try Spark-TTS</h2>
            <div class="tts-form">
              <div class="form-group">
                <label for="textInput">Text to synthesize:</label>
                <textarea id="textInput" placeholder="Enter text to convert to speech...">Hello, this is a demonstration of Spark TTS, an advanced text-to-speech system running on ${systemInfo.gpuAvailable ? 'an NVIDIA ' + systemInfo.gpuName : 'CPU'}.</textarea>
              </div>
              
              <div class="voice-option-group">
                <label>Select Voice Option:</label>
                <div>
                  <input type="radio" id="useRegisteredVoice" name="voiceOption" value="registered" checked>
                  <label for="useRegisteredVoice">Use Registered Voice</label>
                  
                  <input type="radio" id="useCustomVoice" name="voiceOption" value="custom" style="margin-left: 20px;">
                  <label for="useCustomVoice">Upload Custom Voice</label>
                </div>
              </div>
              
              <div id="registeredVoiceSection" class="form-group">
                <label for="voiceSelector">Select Voice:</label>
                <select id="voiceSelector" class="voice-selector">
                  ${Object.entries(systemInfo.voices || {})
                    .map(([voiceId, details]) => 
                      `<option value="${voiceId}" ${details.valid ? '' : 'disabled'}>${details.display_name} ${details.valid ? '' : '(Invalid)'}</option>`
                    ).join('')}
                </select>
              </div>
              
              <div id="customVoiceSection" class="form-group" style="display: none;">
                <label>Upload Voice Sample:</label>
                <div class="file-input-wrapper">
                  <button class="btn">Upload Voice Sample</button>
                  <input type="file" id="voiceInput" accept="audio/*" onchange="updateFileName(this)">
                </div>
                <span class="file-name" id="fileName">No file selected</span>
              </div>
              
              <div class="separator"></div>
              
              <button id="generateBtn" class="btn" onclick="generateSpeech()">Generate Speech</button>
              
              <div id="statusArea" class="status-area">
                <p id="statusText">Processing...</p>
              </div>
              
              <div id="errorLog" class="error-log"></div>
              
              <audio id="audioPlayer" class="audio-player" controls></audio>
            </div>
          </div>
          
          <a href="/" class="back-link"><button class="btn">Back to Home</button></a>
        </div>

        <script>
          function updateFileName(input) {
            const fileName = input.files.length > 0 ? input.files[0].name : 'No file selected';
            document.getElementById('fileName').textContent = fileName;
          }
          
          // Toggle between registered voice and custom voice upload
          document.getElementById('useRegisteredVoice').addEventListener('change', function() {
            document.getElementById('registeredVoiceSection').style.display = 'block';
            document.getElementById('customVoiceSection').style.display = 'none';
          });
          
          document.getElementById('useCustomVoice').addEventListener('change', function() {
            document.getElementById('registeredVoiceSection').style.display = 'none';
            document.getElementById('customVoiceSection').style.display = 'block';
          });
          
          async function generateSpeech() {
            const textInput = document.getElementById('textInput').value.trim();
            const voiceOption = document.querySelector('input[name="voiceOption"]:checked').value;
            const generateBtn = document.getElementById('generateBtn');
            const statusArea = document.getElementById('statusArea');
            const statusText = document.getElementById('statusText');
            const audioPlayer = document.getElementById('audioPlayer');
            const errorLog = document.getElementById('errorLog');
            
            if (!textInput) {
              alert('Please enter text to synthesize');
              return;
            }
            
            // Show status and disable button
            generateBtn.disabled = true;
            statusArea.style.display = 'block';
            statusText.textContent = 'Processing your request...';
            audioPlayer.style.display = 'none';
            errorLog.style.display = 'none';
            
            try {
              const formData = new FormData();
              formData.append('text', textInput);
              
              if (voiceOption === 'registered') {
                const voiceId = document.getElementById('voiceSelector').value;
                formData.append('voiceId', voiceId);
              } else {
                const voiceInput = document.getElementById('voiceInput').files[0];
                if (voiceInput) {
                  formData.append('customVoice', voiceInput);
                }
              }
              
              const response = await fetch('/api/tts', {
                method: 'POST',
                body: formData
              });
              
              const result = await response.json();
              
              if (result.success) {
                statusText.textContent = 'Audio generated successfully!';
                audioPlayer.src = result.audioUrl;
                audioPlayer.style.display = 'block';
              } else {
                statusText.textContent = 'Error: ' + result.message;
                if (result.trace) {
                  console.error('TTS Error Details:', result.trace);
                  errorLog.textContent = result.trace;
                  errorLog.style.display = 'block';
                }
              }
            } catch (error) {
              statusText.textContent = 'Error: ' + error.message;
              errorLog.textContent = error.toString();
              errorLog.style.display = 'block';
            } finally {
              generateBtn.disabled = false;
            }
          }
        </script>
      </body>
    </html>
  `);
});

// Function to refresh the voice list
async function refreshVoiceList() {
  return new Promise((resolve, reject) => {
    PythonShell.run('spark_bridge.py', {
      mode: 'text',
      pythonPath: 'python',
      args: ['--action', 'list_voices']
    }).then(output => {
      let voices = {};
      
      // Find the JSON response containing the voice list
      for (const line of output) {
        try {
          const data = JSON.parse(line);
          if (data.voices) {
            voices = data.voices;
            // Update systemInfo
            systemInfo.voices = voices;
            break;
          }
        } catch (e) {
          // Skip lines that aren't valid JSON
        }
      }
      
      resolve(voices);
    }).catch(err => {
      console.error("Error refreshing voice list:", err);
      reject(err);
    });
  });
}

// API endpoint to list available voices
app.get('/api/voices', async (req, res) => {
  try {
    const voices = await refreshVoiceList();
    res.json({ success: true, voices });
  } catch (error) {
    console.error("Error getting voice list:", error);
    res.status(500).json({ 
      success: false, 
      message: 'Error retrieving voice list',
      error: error.toString()
    });
  }
});

// API endpoint for text-to-speech
app.post('/api/tts', async (req, res) => {
  try {
    // Get text input
    const text = req.body.text;
    if (!text) {
      return res.status(400).json({ success: false, message: 'Text is required' });
    }
    
    // Generate a unique filename
    const timestamp = Date.now();
    const outputPath = path.join(__dirname, 'public', 'audio', `output_${timestamp}.wav`);

    // Make sure the audio directory exists
    fs.mkdirSync(path.join(__dirname, 'public', 'audio'), { recursive: true });
    
    // Set up Python shell options
    const options = {
      mode: 'text',
      pythonPath: 'python', // Use 'python3' if needed
      args: [
        '--action', 'tts',
        '--text', text,
        '--output', outputPath
      ]
    };
    
    // Handle voice selection - either a registered voice ID or a custom uploaded voice
    if (req.body.voiceId) {
      options.args.push('--voice-id', req.body.voiceId);
    } else if (req.files && req.files.customVoice) {
      const voicePath = path.join(__dirname, 'public', 'audio', `voice_${timestamp}.wav`);
      await req.files.customVoice.mv(voicePath);
      options.args.push('--custom-voice', voicePath);
    }
    
    // Run the Python script
    PythonShell.run('spark_bridge.py', options).then(results => {
      console.log("Raw TTS output:", results);
      
      // Find the last valid JSON output (there might be initial status messages)
      let result = null;
      for (let i = results.length - 1; i >= 0; i--) {
        try {
          const parsedResult = JSON.parse(results[i]);
          if (parsedResult.success !== undefined) {  // Check if it's our result object
            result = parsedResult;
            break;
          }
        } catch (e) {
          // Skip lines that can't be parsed as JSON
          continue;
        }
      }
      
      if (!result) {
        // If no valid result was found, try parsing the last line
        try {
          result = JSON.parse(results[results.length - 1]);
        } catch (e) {
          // If still can't parse JSON, check if it's the Spark-TTS import error message
          if (results.some(line => line.includes("Spark-TTS is not properly installed"))) {
            return res.status(500).json({ 
              success: false, 
              message: 'Spark-TTS is not properly installed. Make sure you have all dependencies installed.', 
              rawOutput: results.join('\n')
            });
          }
          
          return res.status(500).json({ 
            success: false, 
            message: 'Invalid response from TTS engine', 
            rawOutput: results.join('\n')
          });
        }
      }
      
      if (result && result.success) {
        // Return the URL to the generated audio file
        const audioUrl = `/public/audio/output_${timestamp}.wav`;
        res.json({ 
          success: true, 
          audioUrl, 
          message: result.message || 'Speech generated successfully',
          voice: result.voice || {}
        });
      } else {
        res.json({ 
          success: false, 
          message: result ? result.message : 'Failed to generate speech',
          trace: result ? result.trace : results.join('\n') 
        });
      }
      
      // Clean up the voice file if it was uploaded
      if (req.files && req.files.customVoice) {
        const voicePath = path.join(__dirname, 'public', 'audio', `voice_${timestamp}.wav`);
        if (fs.existsSync(voicePath)) {
          fs.unlinkSync(voicePath);
        }
      }
    }).catch(err => {
      console.error('Error running Python script:', err);
      res.status(500).json({ 
        success: false, 
        message: 'Error processing TTS request',
        error: err.toString()
      });
    });
  } catch (error) {
    console.error('Server error:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Server error',
      error: error.toString()
    });
  }
});

// Start the server using the function
startServer(); 