#!/usr/bin/env python
# -*- coding: utf-8 -*-

import os
import sys
import json
import argparse
import traceback
from pathlib import Path
from voice_config import VoiceConfig

# Make sure the proper paths are in sys.path
repo_path = Path("./spark-tts-temp").absolute()
sys.path.insert(0, str(repo_path))

# Print paths for debugging
print(f"Current directory: {os.getcwd()}")
print(f"Repository path: {repo_path}")

# Check for CUDA
CUDA_AVAILABLE = False
CUDA_DEVICE = "Unknown"
try:
    import torch
    CUDA_AVAILABLE = torch.cuda.is_available()
    if CUDA_AVAILABLE:
        CUDA_DEVICE = torch.cuda.get_device_name(0)
        print(json.dumps({
            "status": "cuda",
            "device": CUDA_DEVICE,
            "version": torch.version.cuda
        }))
    else:
        print(json.dumps({
            "status": "cpu",
            "message": "CUDA not available, using CPU"
        }))
except ImportError:
    print(json.dumps({
        "status": "cpu",
        "message": "PyTorch not installed, using CPU. Run: pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118"
    }))

# Import Spark-TTS modules with better error handling
try:
    # Import the SparkTTS class from the repository
    print("Attempting to import Spark-TTS modules...")
    
    # Check if the cli module is available
    if (repo_path / "cli" / "SparkTTS.py").exists():
        print(f"Found SparkTTS.py at {repo_path / 'cli' / 'SparkTTS.py'}")
        
        try:
            # Import the SparkTTS class
            from cli.SparkTTS import SparkTTS
            SPARK_TTS_AVAILABLE = True
            print(json.dumps({
                "status": "init",
                "message": "Spark-TTS modules loaded successfully via cli module"
            }))
        except ImportError as e:
            print(f"Error importing from cli module: {e}")
            raise ImportError(f"Failed to import SparkTTS: {e}")
    else:
        print(f"SparkTTS.py not found in cli directory")
        print(f"Available files in repo path: {list(repo_path.glob('**/*.py'))[:10]}")
        raise ImportError("SparkTTS.py not found in expected location")
        
except Exception as e:
    SPARK_TTS_AVAILABLE = False
    print(json.dumps({
        "success": False,
        "message": f"Spark-TTS import error: {str(e)}"
    }))


class VoiceManager:
    def __init__(self):
        self.device = torch.device("cuda" if CUDA_AVAILABLE else "cpu")
        self.tts_models = {}
        self.voice_config = VoiceConfig()
        
    def get_tts(self, voice_id=None):
        """
        Get a TTS model for the specified voice ID.
        If no voice_id is provided, or if the voice doesn't exist,
        returns the default TTS model.
        """
        # If no voice specified or voice doesn't exist, use default
        if voice_id is None or not self.voice_config.get_voice(voice_id):
            if "default" not in self.tts_models:
                # Create default TTS model
                model_dir = Path("pretrained_models/Spark-TTS-0.5B").absolute()
                if not model_dir.exists():
                    raise FileNotFoundError(f"Default model directory not found: {model_dir}. Please run download_model.py first.")
                    
                self.tts_models["default"] = SparkTTS(str(model_dir), self.device)
            return self.tts_models["default"]
        
        # Check if model is already loaded
        if voice_id not in self.tts_models:
            voice = self.voice_config.get_voice(voice_id)
            model_dir = voice['model_dir']
            
            # Verify model directory exists
            if not os.path.exists(model_dir):
                raise FileNotFoundError(f"Model directory for voice '{voice_id}' not found: {model_dir}")
                
            # Load the model
            try:
                self.tts_models[voice_id] = SparkTTS(model_dir, self.device)
            except Exception as e:
                raise RuntimeError(f"Failed to load model for voice '{voice_id}': {str(e)}")
                
        return self.tts_models[voice_id]
    
    def list_voices(self):
        """Return a list of all available voices"""
        voices = self.voice_config.list_voices()
        
        # Add a flag to indicate if voice is loaded
        result = {}
        for voice_id, details in voices.items():
            result[voice_id] = {
                "display_name": details["display_name"],
                "model_dir": details["model_dir"],
                "loaded": voice_id in self.tts_models,
                "valid": os.path.exists(details["model_dir"])
            }
        
        # Always include default voice
        if "default" not in result:
            model_dir = Path("pretrained_models/Spark-TTS-0.5B").absolute()
            result["default"] = {
                "display_name": "Default Voice",
                "model_dir": str(model_dir),
                "loaded": "default" in self.tts_models,
                "valid": model_dir.exists()
            }
            
        return result


# Create global voice manager
voice_manager = VoiceManager()


def process_tts_request(text, voice_id=None, custom_voice_path=None, output_path="output.wav"):
    """
    Process a text-to-speech request using Spark-TTS.
    
    Args:
        text (str): The text to convert to speech
        voice_id (str, optional): Voice ID from the voice registry to use
        custom_voice_path (str, optional): Path to a voice sample for cloning
        output_path (str): Path to save the generated audio file
    
    Returns:
        dict: Result information including success status and file path
    """
    
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    try:
        if not SPARK_TTS_AVAILABLE:
            raise ImportError("Spark-TTS modules not available")
            
        # Get the appropriate TTS model
        tts_engine = voice_manager.get_tts(voice_id)
        
        # Process text to speech
        with torch.no_grad():
            if custom_voice_path:
                voice_path = Path(custom_voice_path)
                if not voice_path.exists():
                    raise FileNotFoundError(f"Voice file not found: {custom_voice_path}")
                
                # Voice cloning mode
                wav = tts_engine.inference(
                    text=text,
                    prompt_speech_path=voice_path,
                    prompt_text="This is a sample voice."
                )
            else:
                # Default voice mode (use control parameters)
                wav = tts_engine.inference(
                    text=text,
                    gender="male",  # Default to male voice
                    pitch="moderate",
                    speed="moderate"
                )
                
            # Save the audio
            import soundfile as sf
            sf.write(str(output_path), wav, samplerate=16000)
            
        # Verify the output file was created
        if not output_path.exists():
            raise FileNotFoundError(f"Output file was not created: {output_path}")
            
        voice_info = {}
        if voice_id:
            voice_config = voice_manager.voice_config.get_voice(voice_id)
            if voice_config:
                voice_info = {
                    "voice_id": voice_id,
                    "voice_name": voice_config["display_name"]
                }
            
        return {
            "success": True,
            "file": str(output_path),
            "message": f"Audio generated successfully using {CUDA_DEVICE if CUDA_AVAILABLE else 'CPU'}",
            "voice": voice_info
        }
            
    except (ImportError, ModuleNotFoundError) as e:
        print(f"Error importing Spark-TTS: {str(e)}")
        # Create a fallback audio file for testing
        with open(output_path, 'wb') as f:
            # Write an empty WAV file
            f.write(b'RIFF$\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00\x00\x04\x00\x00\x00\x04\x00\x00\x01\x00\x08\x00data\x00\x00\x00\x00')
        
        return {
            "success": False,
            "message": f"Spark-TTS is not properly installed: {str(e)}. Created an empty audio file as fallback.",
            "file": str(output_path)
        }
    except FileNotFoundError as e:
        error_trace = traceback.format_exc()
        error_log_path = "tts_error.log"
        with open(error_log_path, "w") as f:
            f.write(f"Error processing text: {text}\n")
            f.write(f"Voice ID: {voice_id}\n")
            f.write(f"Custom voice path: {custom_voice_path}\n")
            f.write(f"Output path: {output_path}\n")
            f.write(f"Exception: {str(e)}\n")
            f.write(f"Traceback:\n{error_trace}")
            
        return {
            "success": False,
            "message": f"File not found: {str(e)}",
            "file": None,
            "trace": error_trace[:200] + "..." if len(error_trace) > 200 else error_trace,
            "log_file": error_log_path
        }
    except Exception as e:
        error_trace = traceback.format_exc()
        error_log_path = "tts_error.log"
        with open(error_log_path, "w") as f:
            f.write(f"Error processing text: {text}\n")
            f.write(f"Voice ID: {voice_id}\n")
            f.write(f"Custom voice path: {custom_voice_path}\n")
            f.write(f"Output path: {output_path}\n")
            f.write(f"Exception: {str(e)}\n")
            f.write(f"Traceback:\n{error_trace}")
            
        return {
            "success": False,
            "message": f"Error generating audio: {str(e)}",
            "file": None,
            "trace": error_trace[:200] + "..." if len(error_trace) > 200 else error_trace,
            "log_file": error_log_path
        }


def handle_list_voices():
    """List all available voices"""
    try:
        voices = voice_manager.list_voices()
        return {
            "success": True,
            "voices": voices
        }
    except Exception as e:
        error_trace = traceback.format_exc()
        return {
            "success": False,
            "message": f"Error listing voices: {str(e)}",
            "trace": error_trace[:200] + "..." if len(error_trace) > 200 else error_trace
        }


if __name__ == "__main__":
    # Parse command line arguments
    parser = argparse.ArgumentParser(description="Spark-TTS Bridge")
    parser.add_argument("--action", default="tts", choices=["tts", "list_voices"], 
                      help="Action to perform (tts or list_voices)")
    parser.add_argument("--text", help="Text to convert to speech")
    parser.add_argument("--voice-id", help="Voice ID from voice registry")
    parser.add_argument("--custom-voice", help="Path to custom voice sample for cloning")
    parser.add_argument("--output", default="output.wav", help="Output audio file path")
    
    try:
        # Process as JSON string for easy parsing in Node.js
        args = parser.parse_args()
        
        if args.action == "list_voices":
            result = handle_list_voices()
        else:  # tts
            if not args.text:
                raise ValueError("--text argument is required for TTS action")
            result = process_tts_request(args.text, args.voice_id, args.custom_voice, args.output)
        
        # Print JSON result for the Node.js process to capture
        print(json.dumps(result))
    except Exception as e:
        # Handle any unexpected errors during argument parsing or processing
        print(json.dumps({
            "success": False,
            "message": f"Unexpected error: {str(e)}",
            "trace": traceback.format_exc()
        })) 