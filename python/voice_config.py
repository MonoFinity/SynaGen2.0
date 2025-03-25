import json
import os
from typing import Dict, Optional

class VoiceConfig:
    CONFIG_FILE = '../config/voice_registry.json'
    
    def __init__(self):
        self.config_path = os.path.join(os.path.dirname(__file__), self.CONFIG_FILE)
        self.voices = self._load_config()

    def _load_config(self) -> Dict:
        if os.path.exists(self.config_path):
            with open(self.config_path, 'r') as f:
                return json.load(f)
        return {}

    def _save_config(self):
        with open(self.config_path, 'w') as f:
            json.dump(self.voices, f, indent=2)

    def add_voice(self, voice_id: str, model_dir: str, display_name: str) -> None:
        """Add or update a voice in the registry"""
        self.voices[voice_id] = {
            'model_dir': model_dir,
            'display_name': display_name
        }
        self._save_config()

    def remove_voice(self, voice_id: str) -> bool:
        """Remove a voice from the registry"""
        if voice_id in self.voices:
            del self.voices[voice_id]
            self._save_config()
            return True
        return False

    def get_voice(self, voice_id: str) -> Optional[Dict]:
        """Get voice configuration by ID"""
        return self.voices.get(voice_id)

    def list_voices(self) -> Dict:
        """Get all registered voices"""
        return self.voices

    def validate_voice(self, voice_id: str) -> bool:
        """Validate if voice exists and model files are present"""
        voice = self.get_voice(voice_id)
        if not voice:
            return False
        return os.path.exists(voice['model_dir']) 