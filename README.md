# SynaGen 2.0

A Node.js server that showcases SynaGen 2.0 with dark mode UI and integration with Spark-TTS.

## Prerequisites

- Node.js (Download and install from [nodejs.org](https://nodejs.org/))
- Python 3.8+ (Download and install from [python.org](https://python.org/))
- pip (Python package manager)

## Installation

1. Clone this repository or download the files
2. Navigate to the project directory
3. Install Node.js dependencies:

```
npm install
```

4. Install Python dependencies:

```
pip install -r ./spark-tts-temp/requirements.txt
pip install huggingface_hub
```

5. Download the Spark-TTS model:

```
python download_model.py
```

## Running the Server

Start the server with:

```
npm start
```

Or run directly with:

```
node server.js
```

Then open your browser and go to [http://localhost:3000](http://localhost:3000) to see the SynaGen 2.0 homepage.

## Features

- **Homepage**: Dark mode UI displaying SynaGen 2.0 with a button to access the Spark-TTS demo
- **Spark-TTS Demo**: A fully functional text-to-speech demo page with the following capabilities:
  - Convert text to natural-sounding speech
  - Upload voice samples for voice cloning
  - Listen to generated audio directly in the browser

## Project Structure

- `server.js` - The main server file that handles all routes and page rendering
- `spark_bridge.py` - Python bridge for interacting with Spark-TTS
- `download_model.py` - Script to download the Spark-TTS model
- `public/audio/` - Directory for storing generated audio files
- `package.json` - Project configuration and dependencies

## About Spark-TTS

Spark-TTS is an advanced text-to-speech system that uses large language models for natural-sounding voice synthesis. For more information, visit the [official GitHub repository](https://github.com/SparkAudio/Spark-TTS). 