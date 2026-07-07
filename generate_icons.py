"""
GPT 이미지 자동 생성기  픽셀아트 아이콘 생성 스크립트
베레모 + 별눈 + 연필 캐릭터 (카드뉴스 제작자 느낌)
128px 마스터 그리드  48px / 16px NEAREST 리사이징
"""

from PIL import Image, ImageDraw
import os

#  팔레트 
BG        = (90,  209, 185, 255)   # 민트 배경 #5AD1B9
CORAL_BG  = (255, 122,  92, 255)   # 산호 포인트 (사용 안 함  BG로 통일)
SKIN      = (255, 213, 168, 255)   # 피부 #FFD5A8
SKIN_SHD  = (230, 180, 130, 255)   # 피부 그림자
BERET     = ( 9, 127, 232, 255)    # 베레모 파랑 #097FE8
BERET_SHD = ( 5,  90, 170, 255)    # 베레모 그림자
HAIR      = ( 61,  43,  31, 255)   # 머리카락/두께 #3D2B1F
GLASSES   = ( 30,  30,  30, 255)   # 안경테 #1E1E1E
EYE_STAR  = (255, 230,  50, 255)   # 별 눈 노랑 #FFE632
EYE_WHITE = (255, 255, 255, 255)   # 별 반짝 흰
MOUTH     = (200,  80,  60, 255)   # 입 산호
PENCIL_B  = (255, 210,  40, 255)   # 연필 몸통 노랑
PENCIL_T  = ( 50,  50,  50, 255)   # 연필 팁 검정
PENCIL_E  = (255, 150, 120, 255)   # 연필 지우개 살구
WHITE     = (255, 255, 255, 255)
TRANSP    = (  0,   0,   0,   0)

SIZE  = 128   # 마스터 크기
BLOCK = 8     # 1 픽셀 = 8px (128 / 16 그리드)

def px(draw, gx, gy, color, w=1, h=1):
    """그리드 좌표 (gx,gy)에 wh 블록 그리기"""
    x, y = gx * BLOCK, gy * BLOCK
    draw.rectangle([x, y, x + BLOCK*w - 1, y + BLOCK*h - 1], fill=color)

def make_icon():
    img = Image.new('RGBA', (SIZE, SIZE), TRANSP)
    d = ImageDraw.Draw(img)

    #  배경 원형 
    d.ellipse([0, 0, SIZE-1, SIZE-1], fill=BG)

    #  몸통 (간략)  6~15 열, 11~15 행 
    for gy in range(11, 16):
        for gx in range(4, 12):
            if gy == 11:
                px(d, gx, gy, BERET_SHD)
            else:
                px(d, gx, gy, HAIR)

    #  얼굴 (타원형 베이스)  3~12 열, 5~12 행 
    face_cells = [
        (4,5),(5,5),(6,5),(7,5),(8,5),(9,5),(10,5),(11,5),
        (3,6),(4,6),(5,6),(6,6),(7,6),(8,6),(9,6),(10,6),(11,6),(12,6),
        (3,7),(4,7),(5,7),(6,7),(7,7),(8,7),(9,7),(10,7),(11,7),(12,7),
        (3,8),(4,8),(5,8),(6,8),(7,8),(8,8),(9,8),(10,8),(11,8),(12,8),
        (3,9),(4,9),(5,9),(6,9),(7,9),(8,9),(9,9),(10,9),(11,9),(12,9),
        (4,10),(5,10),(6,10),(7,10),(8,10),(9,10),(10,10),(11,10),
        (5,11),(6,11),(7,11),(8,11),(9,11),(10,11),
    ]
    for (gx, gy) in face_cells:
        px(d, gx, gy, SKIN)

    # 볼 그림자
    px(d, 4, 9, SKIN_SHD)
    px(d, 11, 9, SKIN_SHD)

    #  베레모 
    beret_cells = [
        (4,3),(5,3),(6,3),(7,3),(8,3),(9,3),(10,3),(11,3),
        (3,4),(4,4),(5,4),(6,4),(7,4),(8,4),(9,4),(10,4),(11,4),(12,4),
        (3,5),(4,5),(5,5),(6,5),(7,5),(8,5),(9,5),(10,5),(11,5),(12,5),
    ]
    for (gx, gy) in beret_cells:
        px(d, gx, gy, BERET)

    # 베레모 그림자 (아랫줄)
    for gx in range(4, 12):
        px(d, gx, 5, BERET_SHD)

    # 베레모 꼭지
    px(d, 8, 2, BERET)
    px(d, 7, 2, BERET)

    #  얼굴 재적용 (베레모 위에 피부 덮기) 
    for (gx, gy) in face_cells:
        if gy >= 6:   # 베레모 행 이후만
            px(d, gx, gy, SKIN)
    px(d, 4, 9, SKIN_SHD)
    px(d, 11, 9, SKIN_SHD)

    #  안경 
    # 왼쪽 안경 테두리
    for gx in range(4, 7):
        px(d, gx, 7, GLASSES)   # 위
        px(d, gx, 9, GLASSES)   # 아래
    px(d, 3, 8, GLASSES)        # 왼 사이드
    px(d, 6, 8, GLASSES)        # 오른 사이드

    # 오른쪽 안경 테두리
    for gx in range(8, 11):
        px(d, gx, 7, GLASSES)
        px(d, gx, 9, GLASSES)
    px(d, 11, 8, GLASSES)
    px(d, 7, 8, GLASSES)        # 코 다리

    # 안경 렌즈 내부 피부색 복원
    for gy in [8]:
        for gx in [4, 5, 9, 10]:
            px(d, gx, gy, SKIN)

    #  별 눈 
    # 왼쪽 눈  5열 8행 기준 별 모양
    star_l = [(5,8)]
    for (gx, gy) in star_l:
        px(d, gx-1, gy,   EYE_STAR)   # 
        px(d, gx+1, gy,   EYE_STAR)   # 
        px(d, gx,   gy-1, EYE_STAR)   # 
        px(d, gx,   gy+1, EYE_STAR)   # 
        px(d, gx,   gy,   EYE_WHITE)  # 중심 반짝

    # 오른쪽 눈  9열 8행
    star_r = [(10,8)]
    for (gx, gy) in star_r:
        px(d, gx-1, gy,   EYE_STAR)
        px(d, gx+1, gy,   EYE_STAR)
        px(d, gx,   gy-1, EYE_STAR)
        px(d, gx,   gy+1, EYE_STAR)
        px(d, gx,   gy,   EYE_WHITE)

    #  입 (미소) 
    px(d, 6, 10, MOUTH)
    px(d, 7, 11, MOUTH)
    px(d, 8, 11, MOUTH)
    px(d, 9, 10, MOUTH)

    #  연필 (오른쪽 하단, 대각선) 
    pencil = [
        # (gx, gy, color)
        (12, 9,  PENCIL_E),   # 지우개
        (12, 10, PENCIL_B),   # 몸통
        (13, 10, PENCIL_B),
        (13, 11, PENCIL_B),
        (14, 11, PENCIL_B),
        (14, 12, PENCIL_B),
        (15, 12, PENCIL_T),   # 팁
    ]
    for (gx, gy, col) in pencil:
        px(d, gx, gy, col)

    return img

def save_icons(out_dir):
    os.makedirs(out_dir, exist_ok=True)
    master = make_icon()

    sizes = [128, 48, 16]
    filenames = {
        128: 'icon128.png',
        48:  'icon48.png',
        16:  'icon16.png',
    }

    for s in sizes:
        if s == 128:
            icon = master
        else:
            icon = master.resize((s, s), Image.NEAREST)
        path = os.path.join(out_dir, filenames[s])
        icon.save(path)
        print(f' Saved: {path} ({s}x{s})')

if __name__ == '__main__':
    out_dir = os.path.join(os.path.dirname(__file__), 'icons')
    save_icons(out_dir)
    print('\n Icons generated!')
