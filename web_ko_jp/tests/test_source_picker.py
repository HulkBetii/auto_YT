from source_picker import rank_candidates, score_title

# Real titles from the source channel (2026-10-04).
PEOPLE = "Cổ Nhân Dạy: Kẻ Hay Nói Lời Này Thường Cực Kỳ Thâm Hiểm – Càng Thân Càng Phải Đề Phòng"
BETRAY = "8 Loại Người Có Thể BÁN ĐỨNG Bạn BẤT CỨ LÚC NÀO | Triết Lý Cuộc Sống"
OLD_AGE = "Cổ Nhân Dạy: Tuổi Già SƯỚNG Hay KHỔ, Phụ Thuộc Vào 8 Điều Này | Triết Lý Cuộc Sống"
GENERIC = "9 Bài Học KINH ĐIỂN Của Cổ Nhân – Hiểu Được Một Lần, Sáng Cả Một Đời"


def test_people_angle_outranks_generic_lessons_despite_views():
    entries = [
        {"id": "generic", "title": GENERIC, "view_count": 55000},
        {"id": "people", "title": PEOPLE, "view_count": 13000},
        {"id": "betray", "title": BETRAY, "view_count": 5400},
        {"id": "old", "title": OLD_AGE, "view_count": 55000},
    ]
    order = [c.video_id for c in rank_candidates(entries, cloned_ids=set())]
    assert order.index("people") < order.index("generic")
    assert order.index("betray") < order.index("generic")
    assert order.index("old") < order.index("generic")


def test_already_cloned_videos_sink_to_the_bottom():
    entries = [{"id": "people", "title": PEOPLE, "view_count": 13000}, {"id": "g", "title": GENERIC}]
    ranked = rank_candidates(entries, cloned_ids={"people"})
    assert ranked[-1].video_id == "people" and ranked[-1].already_cloned


def test_angles_are_explained():
    candidate = score_title(PEOPLE)
    assert any(a.startswith("people:") for a in candidate.angles)
    assert any(a.startswith("classic:") for a in candidate.angles)
