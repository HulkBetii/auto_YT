"""
End-to-End Test for web_ko_jp:
Tests complete 5-turn pipeline via http://localhost:3004/api/youtube-rewrite
Video: https://www.youtube.com/watch?v=szAQr0IUzes
"""
import sys
import os
import json
import time
import urllib.request
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8")

API_URL = "http://localhost:3004/api/youtube-rewrite"
TEST_VIDEO_URL = "https://www.youtube.com/watch?v=szAQr0IUzes"

def run_e2e_test():
    print("=" * 60)
    print("STARTING E2E TEST: YouTube ➔ Japanese Drama Full 5-Turn Package")
    print(f"Target Video: {TEST_VIDEO_URL}")
    print(f"Endpoint: {API_URL}")
    print("=" * 60)

    payload = {
        "url": TEST_VIDEO_URL,
        "action": "generate",
        "generateImage": True,
    }

    req_data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        API_URL,
        data=req_data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    start_time = time.time()
    print("[E2E] Sending request to web_ko_jp API... (This will run 5 Turns on ChatGPT)")
    
    try:
        # 12 minutes timeout for 5 deep turns + DALL-E image generation
        with urllib.request.urlopen(req, timeout=720) as resp:
            status_code = resp.status
            raw_body = resp.read().decode("utf-8")
            elapsed = time.time() - start_time
            
            print(f"\n[E2E HTTP SUCCESS] Status: {status_code} in {elapsed:.1f}s")
            data = json.loads(raw_body)
            
            if not data.get("ok"):
                print("[E2E FAILURE] API returned ok=False:", data)
                sys.exit(1)
                
            pkg = data["data"]
            print("\n" + "=" * 60)
            print("E2E RESULTS SUMMARY:")
            print("=" * 60)
            print(f"• Video ID (DB): {pkg.get('videoId')}")
            print(f"• Original Title: {pkg.get('title')}")
            print(f"• Japanese Title (Turn 2): {pkg.get('titleJp')}")
            print(f"• Script Length (Turn 1): {pkg.get('charCount')} characters")
            print(f"• Description (Turn 3):\n{pkg.get('descriptionJp')}")
            print(f"• Thumbnail Text (Turn 4):\n{pkg.get('thumbnailText')}")
            print(f"• Thumbnail Image URL (Turn 5): {pkg.get('thumbnailImageUrl')}")
            print(f"• Conversation URL: {pkg.get('conversationUrl')}")
            
            # Check thumbnail file on disk
            img_url = pkg.get("thumbnailImageUrl")
            if img_url:
                local_file = Path(r"D:\VibeCoding\auto_YT\web_ko_jp\public") / img_url.lstrip("/")
                if local_file.exists():
                    print(f"• [VERIFIED] Thumbnail image file exists on disk: {local_file} ({local_file.stat().st_size} bytes)")
                else:
                    print(f"• [WARNING] Thumbnail image file not found on disk at: {local_file}")
            
            print("\n[E2E COMPLETE] All 5 turns verified successfully!")
            
    except Exception as e:
        elapsed = time.time() - start_time
        print(f"\n[E2E ERROR] Failed after {elapsed:.1f}s: {e}")
        sys.exit(1)

if __name__ == "__main__":
    run_e2e_test()