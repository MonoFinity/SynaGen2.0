#!/usr/bin/env python
# -*- coding: utf-8 -*-

import os
import sys
import json
from pathlib import Path

try:
    import torch
    from huggingface_hub import snapshot_download
    
    # Check for CUDA availability (for NVIDIA GPU)
    if torch.cuda.is_available():
        print(f"CUDA is available. Found {torch.cuda.device_count()} device(s).")
        print(f"Using CUDA device: {torch.cuda.get_device_name(0)}")
        cuda_version = torch.version.cuda
        print(f"CUDA version: {cuda_version}")
    else:
        print("CUDA is not available. Using CPU instead.")
    
    # Download the Spark-TTS model
    print("Downloading Spark-TTS model from Hugging Face Hub...")
    
    # Use the 0.5B model which is publicly available
    model_path = Path("pretrained_models/Spark-TTS-0.5B")
    
    if model_path.exists():
        print(f"Model already exists at {model_path}")
    else:
        print("Downloading the Spark-TTS 0.5B model which will be optimized for your NVIDIA 4090 RTX...")
        model_path.parent.mkdir(parents=True, exist_ok=True)
        
        # Set up the repository to download
        repo_id = "SparkAudio/Spark-TTS-0.5B"
        
        # Download the model
        snapshot_download(
            repo_id, 
            local_dir=str(model_path),
            ignore_patterns=["*.safetensors.index.json"],
            resume_download=True,
            local_files_only=False
        )
        print(f"Model downloaded to {model_path}")
    
except ImportError as e:
    print(f"Error: {str(e)}")
    print("Please install required packages: pip install huggingface_hub torch")
except Exception as e:
    print(f"Error downloading model: {str(e)}") 