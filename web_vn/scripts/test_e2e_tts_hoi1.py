# -*- coding: utf-8 -*-
import sys, os, json, logging
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
logging.basicConfig(level=logging.INFO, format='%(asctime)s [%(levelname)s] %(message)s')
logger = logging.getLogger('e2e_hoi1_tts')

REPO_ROOT = Path(r'D:\VibeCoding\auto_YT')
SRC_SCRIPTS = REPO_ROOT / 'web_vn' / 'scripts'
if str(SRC_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SRC_SCRIPTS))

from script_audio_parser import parse_script_to_manifest

def main():
    story_dir = REPO_ROOT / 'web_vn' / 'output' / 'story_e2e_test_01'
    script_file = story_dir / 'full_story_script.md'
    manifest_file = story_dir / 'audio_manifest.jsonl'

    logger.info(f'Parsing script: {script_file}')
    manifest_entries = parse_script_to_manifest(script_file, manifest_file)

    logger.info(f'Total entries in manifest: {len(manifest_entries)}')
    ch1_entries = [e for e in manifest_entries if e.get('chapter') == 1]
    logger.info(f'Chapter 1 entries: {len(ch1_entries)}')

    print('\n--- FIRST 15 CHUNKS OF CHAPTER 1 (CLEAN DIALOGUE & NARRATION) ---')
    for i, e in enumerate(ch1_entries[:15], start=1):
        print(f"{i:02d}. [{e['id']}] [{e['speaker_id']}] ({e['words']} words): {e['text']}")
    print('----------------------------------------------------------------\n')

if __name__ == '__main__':
    main()
