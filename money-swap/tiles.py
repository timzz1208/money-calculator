"""
用 Blender（bpy）算刻字石碑：每個字一張透明背景 PNG，存到 tiles/。
檔名與 video.html 對應：一般字 <unicode16進位>.png，朱紅描紅 v_<unicode16進位>.png。

做法：先用字型畫出「高度圖」（石面白、刻痕黑、刻痕邊緣有斜面、石碑邊緣圓角與崩角），
再在 Blender 用細密網格照高度圖推出真實凹凸，顏色也依高度分成石面與刻痕。
不用布林運算，中文字再複雜都穩定。

用法：python3 tiles.py 思源宋體.ttf [--only 錢在] [--samples 48] [--px 640]
需要：pip install bpy fonttools skia-pathops pillow scipy
"""
import math
import os
import sys
import time

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage
from fontTools.ttLib import TTFont
from fontTools.ttLib.removeOverlaps import removeOverlaps
from fontTools.subset import Subsetter, Options
from fontTools.varLib import instancer
import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'tiles')
args = sys.argv[1:]
FONT_SRC = args[0]


def opt(k, d):
    return args[args.index(k) + 1] if k in args else d


SAMPLES = int(opt('--samples', 48))
PX = int(opt('--px', 640))
ONLY = opt('--only', None)
N = 1024            # 高度圖解析度
GRID = 720          # 網格細分數

# 影片用到的字（True＝朱紅描紅）
TILES = [('你', False), ('以', False), ('為', False), ('在', False), ('賺', False), ('錢', True), ('？', False),
         ('工', False), ('作', False), ('睡', False), ('覺', False), ('讓', False), ('去', False), ('上', False), ('班', False)]
if ONLY:
    TILES = [t for t in TILES if t[0] in ONLY]


def key_of(ch, verm):
    return ('v_' if verm else '') + format(ord(ch), 'x')


# ---------- 1. 粗細 900、去除重疊的小字型檔 ----------
def static_font():
    out = os.path.join(OUT, '_font_black.ttf')
    if os.path.exists(out):
        return out
    f = TTFont(FONT_SRC)
    o = Options()
    o.layout_features = []
    s = Subsetter(o)
    s.populate(text='你以為在賺錢？工作睡覺讓去上班')
    s.subset(f)
    if 'fvar' in f:
        f = instancer.instantiateVariableFont(f, {'wght': 900})
    removeOverlaps(f)
    f.save(out)
    return out


# ---------- 2. 高度圖 ----------
def smooth_noise(rng, res, size):
    z = rng.standard_normal((res, res))
    z = ndimage.zoom(z, size / res, order=3)[:size, :size]
    return z / (np.abs(z).max() + 1e-9)


def heightmap(ch, font_path, seed):
    rng = np.random.default_rng(seed)
    img = Image.new('L', (N, N), 0)
    d = ImageDraw.Draw(img)
    font = ImageFont.truetype(font_path, int(N * 0.74))
    bb = d.textbbox((0, 0), ch, font=font)
    d.text((N / 2 - (bb[0] + bb[2]) / 2, N / 2 - (bb[1] + bb[3]) / 2 + N * 0.01), ch, font=font, fill=255)
    mask = np.asarray(img) > 127

    # 刻痕：邊緣 14px 的斜面，再往內是平底
    d_in = ndimage.distance_transform_edt(mask)
    carve = np.clip(d_in / 14.0, 0, 1)
    h_glyph = 1 - carve

    # 石碑邊緣：圓角斜面
    yy, xx = np.mgrid[0:N, 0:N]
    d_b = np.minimum.reduce([xx, yy, N - 1 - xx, N - 1 - yy]).astype(float)
    e = np.sin(np.clip(d_b / 34.0, 0, 1) * math.pi / 2)
    h_edge = 0.3 + 0.7 * e

    # 崩角：沿邊緣隨機咬掉幾塊
    chip = np.zeros((N, N))
    wob = smooth_noise(rng, 60, N)
    for _ in range(8):
        side = rng.integers(4)
        u = rng.uniform(0.06, 0.94) * N
        cx, cy = [(u, 0), (N - 1, u), (u, N - 1), (0, u)][side]
        r = rng.uniform(12, 40)
        ang = np.arctan2(yy - cy, xx - cx)
        jag = 1 + 0.45 * np.sign(np.sin(ang * rng.integers(3, 6) + rng.uniform(0, 6)))   # 不規則碎裂邊
        dist = np.hypot(xx - cx, yy - cy) / jag + wob * r * 0.9
        chip = np.maximum(chip, np.clip((r - dist) / 6.0, 0, 1))
    h_edge = h_edge * (1 - 0.75 * chip)

    # 石面起伏與細顆粒
    noise = smooth_noise(rng, 40, N) * 0.018 + rng.standard_normal((N, N)) * 0.004
    h = np.minimum(h_edge, h_glyph) + noise
    h = np.clip(h, 0, 1)
    groove = np.clip((0.55 - np.minimum(h_glyph, 1)) / 0.2, 0, 1)   # 刻痕區（給顏色用）
    return h, groove


def save16(a, path):
    Image.fromarray((np.clip(a, 0, 1) * 65535).astype(np.uint16)).save(path)


# ---------- 3. Blender 場景 ----------
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = SAMPLES
    sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 6
    sc.render.film_transparent = True
    sc.render.resolution_x = sc.render.resolution_y = PX
    sc.render.image_settings.file_format = 'PNG'
    sc.render.image_settings.color_mode = 'RGBA'
    sc.view_settings.view_transform = 'AgX'
    sc.view_settings.look = 'AgX - Medium High Contrast'
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    bg = world.node_tree.nodes['Background']
    bg.inputs[0].default_value = (0.05, 0.065, 0.09, 1)   # 很弱的冷色環境光
    bg.inputs[1].default_value = 0.3
    sc.world = world
    return sc


def nd(nt, kind, loc, **inputs):
    n = nt.nodes.new(kind)
    n.location = loc
    for k, v in inputs.items():
        n.inputs[k].default_value = v
    return n


def tile_material(h_img, g_img, verm, seed):
    m = bpy.data.materials.new('tile')
    m.use_nodes = True
    nt = m.node_tree
    L = nt.links.new
    bsdf = nt.nodes['Principled BSDF']
    uv = nd(nt, 'ShaderNodeTexCoord', (-1400, 0))
    mp = nd(nt, 'ShaderNodeMapping', (-1200, 0))
    mp.inputs['Location'].default_value = (seed * 3.1, seed * 1.7, 0)
    L(uv.outputs['UV'], mp.inputs['Vector'])

    # 石面顏色：兩層噪聲
    n1 = nd(nt, 'ShaderNodeTexNoise', (-1000, 300), Scale=5.0, Detail=12.0, Roughness=0.62)
    n2 = nd(nt, 'ShaderNodeTexNoise', (-1000, 50), Scale=38.0, Detail=8.0, Roughness=0.7)
    L(mp.outputs['Vector'], n1.inputs['Vector'])
    L(mp.outputs['Vector'], n2.inputs['Vector'])
    ramp = nd(nt, 'ShaderNodeValToRGB', (-780, 300))
    ramp.color_ramp.elements[0].color = (0.46, 0.42, 0.36, 1)
    ramp.color_ramp.elements[1].color = (0.80, 0.74, 0.64, 1)
    ramp.color_ramp.elements[0].position = 0.34
    ramp.color_ramp.elements[1].position = 0.7
    L(n1.outputs['Fac'], ramp.inputs['Fac'])
    speck = nd(nt, 'ShaderNodeMix', (-560, 300))
    speck.data_type = 'RGBA'
    speck.blend_type = 'MULTIPLY'
    speck.inputs['Factor'].default_value = 0.35
    L(ramp.outputs['Color'], speck.inputs[6])
    L(n2.outputs['Color'], speck.inputs[7])

    # 邊緣磨亮（Pointiness）
    geo = nd(nt, 'ShaderNodeNewGeometry', (-1000, 600))
    pr = nd(nt, 'ShaderNodeMapRange', (-780, 600))
    pr.inputs['From Min'].default_value = 0.49
    pr.inputs['From Max'].default_value = 0.56
    pr.inputs['To Min'].default_value = 0.8
    pr.inputs['To Max'].default_value = 1.25
    L(geo.outputs['Pointiness'], pr.inputs['Value'])
    wear = nd(nt, 'ShaderNodeMix', (-360, 400))
    wear.data_type = 'RGBA'
    wear.blend_type = 'MULTIPLY'
    wear.inputs['Factor'].default_value = 1.0
    L(speck.outputs[2], wear.inputs[6])
    comb = nd(nt, 'ShaderNodeCombineColor', (-560, 600))
    for i in range(3):
        L(pr.outputs['Result'], comb.inputs[i])
    L(comb.outputs['Color'], wear.inputs[7])

    # 刻痕顏色：深色積灰，或朱紅舊顏料（局部磨掉）
    gtex = nt.nodes.new('ShaderNodeTexImage')
    gtex.location = (-1000, -300)
    gtex.image = g_img
    gtex.image.colorspace_settings.name = 'Non-Color'
    L(uv.outputs['UV'], gtex.inputs['Vector'])
    if verm:
        wn = nd(nt, 'ShaderNodeTexNoise', (-1000, -600), Scale=22.0, Detail=10.0, Roughness=0.7)
        L(mp.outputs['Vector'], wn.inputs['Vector'])
        vr = nd(nt, 'ShaderNodeValToRGB', (-780, -600))
        vr.color_ramp.elements[0].color = (0.22, 0.18, 0.15, 1)
        vr.color_ramp.elements[1].color = (0.40, 0.03, 0.012, 1)
        vr.color_ramp.elements[0].position = 0.33
        vr.color_ramp.elements[1].position = 0.40
        L(wn.outputs['Fac'], vr.inputs['Fac'])
        groove_col = vr.outputs['Color']
    else:
        gc = nd(nt, 'ShaderNodeMix', (-780, -600))
        gc.data_type = 'RGBA'
        gc.inputs[6].default_value = (0.045, 0.04, 0.035, 1)
        gc.inputs[7].default_value = (0.10, 0.09, 0.08, 1)
        L(n2.outputs['Fac'], gc.inputs['Factor'])
        groove_col = gc.outputs[2]
    fin = nd(nt, 'ShaderNodeMix', (-150, 200))
    fin.data_type = 'RGBA'
    L(gtex.outputs['Color'], fin.inputs['Factor'])
    L(wear.outputs[2], fin.inputs[6])
    L(groove_col, fin.inputs[7])
    L(fin.outputs[2], bsdf.inputs['Base Color'])
    rough = nd(nt, 'ShaderNodeMapRange', (-150, -100))
    rough.inputs['To Min'].default_value = 0.9
    rough.inputs['To Max'].default_value = 0.6 if verm else 1.0
    L(gtex.outputs['Color'], rough.inputs['Value'])
    L(rough.outputs['Result'], bsdf.inputs['Roughness'])
    # 細部凹凸
    bump = nd(nt, 'ShaderNodeBump', (-150, -350), Strength=0.3, Distance=0.004)
    L(n2.outputs['Fac'], bump.inputs['Height'])
    L(bump.outputs['Normal'], bsdf.inputs['Normal'])
    return m


def build(ch, verm, font_path, idx):
    h, g = heightmap(ch, font_path, 1000 + idx)
    hp = os.path.join(OUT, '_h.png')
    gp = os.path.join(OUT, '_g.png')
    save16(h, hp)
    save16(g, gp)
    h_img = bpy.data.images.load(hp)
    h_img.colorspace_settings.name = 'Non-Color'
    g_img = bpy.data.images.load(gp)

    bpy.ops.mesh.primitive_grid_add(x_subdivisions=GRID, y_subdivisions=GRID, size=1)
    plane = bpy.context.object
    tex = bpy.data.textures.new('h', 'IMAGE')
    tex.image = h_img
    tex.extension = 'EXTEND'
    disp = plane.modifiers.new('disp', 'DISPLACE')
    disp.texture = tex
    disp.texture_coords = 'UV'
    disp.mid_level = 1.0
    disp.strength = 0.07
    bpy.ops.object.shade_smooth()
    plane.data.materials.append(tile_material(h_img, g_img, verm, idx))
    return plane


def sun(elev_deg, azim_deg, strength, angle_deg, color):
    """平行光：elev 仰角，azim 以畫面上方為 0°、順時針；光從該方向照過來"""
    bpy.ops.object.light_add(type='SUN')
    s = bpy.context.object
    s.data.energy = strength
    s.data.angle = math.radians(angle_deg)
    s.data.color = color
    e, a = math.radians(elev_deg), math.radians(azim_deg)
    d = np.array([math.sin(a) * math.cos(e), math.cos(a) * math.cos(e), math.sin(e)])   # 指向光源
    # 燈的 −Z 軸要指向 −d
    s.rotation_euler = (math.atan2(math.hypot(d[0], d[1]), d[2]), 0, math.atan2(d[1], d[0]) + math.pi / 2)
    return s


def lights_and_camera():
    # 主光：左上方、仰角 48°、偏硬；刻痕往右下投影
    sun(48, -40, 4.2, 2.5, (1.0, 0.95, 0.88))
    # 右下方冷色補光，很弱
    sun(30, 140, 0.35, 12, (0.7, 0.8, 1.0))
    # 正上方正交鏡頭（2D 合成時每塊角度一致）
    bpy.ops.object.camera_add(location=(0, 0, 4), rotation=(0, 0, 0))
    cam = bpy.context.object
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 1.04
    bpy.context.scene.camera = cam


def main():
    os.makedirs(OUT, exist_ok=True)
    fpath = static_font()
    for i, (ch, verm) in enumerate(TILES):
        t0 = time.time()
        sc = reset()
        build(ch, verm, fpath, i)
        lights_and_camera()
        sc.render.filepath = os.path.join(OUT, key_of(ch, verm) + '.png')
        bpy.ops.render.render(write_still=True)
        print(f'{ch}{"（朱紅）" if verm else ""} → {key_of(ch, verm)}.png  {time.time() - t0:.1f} 秒', flush=True)
    for tmp in ('_h.png', '_g.png'):
        p = os.path.join(OUT, tmp)
        if os.path.exists(p):
            os.remove(p)


main()
