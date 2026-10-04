"""
channel_profile.py
==================
Channel identity and niche vocabulary for 人生の真理 (@人生の真理JP).

Why: metadata rules (title anchors, tags, source scoring) used to live as magic strings inside
ChatGPT prompts. They are declared once here so prompts, validators and the gate agree.
Vocabulary below was checked against YouTube JP autocomplete on 2026-10-03/04.
"""

CHANNEL_NAME = "人生の真理"
CHANNEL_HANDLE = "@人生の真理JP"
SOURCE_CHANNEL_HANDLE = "@TrietLyCuocSong-TT"
NICHE = "先人の知恵 / 処世術"

# Fixed description hashtags (all three have search demand).
FIXED_HASHTAGS = "#人間関係 #人生哲学 #先人の知恵"
HASHTAG_MIN = 3
HASHTAG_MAX = 5

# 処世訓 has no autocomplete demand; Japanese viewers type 処世術.
TIER1_CORE = ["処世術", "人生哲学", "先人の知恵", "人間関係", "生き方", "人生後半"]

# Phrases with confirmed JP autocomplete demand. A title must open with one of them.
TITLE_ANCHORS = [
    "関わってはいけない人",
    "縁を切るべき人",
    "縁を切れ",
    "距離を置くべき人",
    "性格が悪い人",
    "性根が腐った人",
    "人の本性",
    "人間の本性",
    "信用してはいけない人",
    "先人の知恵",
    "先人の教え",
    "先人の言葉",
    "昔の人の言葉",
    "処世術",
    "身内",
    "家族",
    "親戚",
    "老後",
    "晩年",
    "50代",
    "60代",
    "70代",
    "論語",
    "孔子",
    "老子",
    "菜根譚",
]
TITLE_ANCHOR_WINDOW = 24       # anchor must start within the first N chars (after a leading 【…】)
TITLE_DISPLAY_MAX = 55         # mobile shows roughly this many JP chars
TITLE_HARD_MAX = 100           # YouTube limit

BANNED_TITLE_PATTERNS = [
    r"99\s*[%％]\s*が知らない",
]

# Classical sources: JP name -> VN names that must appear in the source transcript before the
# JP name may be used in a title (no false attribution).
CLASSIC_SOURCES = {
    "論語": ["luận ngữ"],
    "孔子": ["khổng tử", "khổng phu tử"],
    "老子": ["lão tử", "đạo đức kinh"],
    "道徳経": ["đạo đức kinh"],
    "菜根譚": ["thái căn đàm"],
    "孟子": ["mạnh tử"],
    "荘子": ["trang tử"],
    "韓非子": ["hàn phi tử", "hàn phi"],
    "増広賢文": ["tăng quảng hiền văn"],
    "孫子": ["tôn tử"],
}

# Source-picker lexicons (Vietnamese titles of the source channel). Weights reflect Studio data:
# the only video YouTube tested widely was a "spot the bad person" topic.
SOURCE_SCORE_PEOPLE = 3.0
SOURCE_SCORE_OLD_AGE = 2.0
SOURCE_SCORE_CLASSIC = 1.0
SOURCE_PEOPLE_TERMS = [
    "kẻ", "loại người", "kiểu người", "người thân", "họ hàng", "lợi dụng", "thâm hiểm", "đố kỵ",
    "bán đứng", "ích kỷ", "tâm địa", "phản bội", "xem thường", "coi thường", "tiểu nhân",
    "giả tạo", "độc ác", "thâm độc", "đề phòng", "tránh xa", "kết giao", "giao du",
]
SOURCE_OLD_AGE_TERMS = ["tuổi già", "về già", "càng già", "lúc già", "tuổi xế chiều", "người già"]
SOURCE_CLASSIC_TERMS = [
    "cổ nhân", "người xưa", "ông bà", "khổng tử", "lão tử", "luận ngữ", "trang tử", "mạnh tử",
    "tăng quảng hiền văn", "thái căn đàm", "quỷ cốc tử",
]
