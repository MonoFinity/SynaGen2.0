#!/usr/bin/env python
import argparse
from voice_config import VoiceConfig

def main():
    parser = argparse.ArgumentParser(description='Manage TTS voices')
    subparsers = parser.add_subparsers(dest='command', help='Commands')

    # Add voice command
    add_parser = subparsers.add_parser('add', help='Add or update a voice')
    add_parser.add_argument('voice_id', help='Unique identifier for the voice')
    add_parser.add_argument('model_dir', help='Path to model directory')
    add_parser.add_argument('display_name', help='Display name for the voice')

    # Remove voice command
    remove_parser = subparsers.add_parser('remove', help='Remove a voice')
    remove_parser.add_argument('voice_id', help='Voice ID to remove')

    # List voices command
    subparsers.add_parser('list', help='List all voices')

    args = parser.parse_args()
    config = VoiceConfig()

    if args.command == 'add':
        config.add_voice(args.voice_id, args.model_dir, args.display_name)
        print(f"Voice '{args.voice_id}' added/updated successfully")
    
    elif args.command == 'remove':
        if config.remove_voice(args.voice_id):
            print(f"Voice '{args.voice_id}' removed successfully")
        else:
            print(f"Voice '{args.voice_id}' not found")
    
    elif args.command == 'list':
        voices = config.list_voices()
        print("\nRegistered Voices:")
        print("================")
        for voice_id, details in voices.items():
            print(f"\nID: {voice_id}")
            print(f"Name: {details['display_name']}")
            print(f"Model Directory: {details['model_dir']}")
            print(f"Valid: {config.validate_voice(voice_id)}")

if __name__ == '__main__':
    main() 