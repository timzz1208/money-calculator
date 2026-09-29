"""
用 Blender（bpy）算刻字石碑：每個字一張透明背景 PNG，存到 tiles/。
檔名與 video.html 對應：一般字 <unicode16進位>.png，朱紅描紅 v_<unicode16進位>.png。

用法：python3 tiles.py 思源宋體.ttf [--only 錢] [--samples 48] [--px 640]
需要：pip install bpy fonttools skia-pathops
"""
import math
import os
import random
import sys
import time

import bpy
from fontTools.ttLib import TTFont
from fontTools.ttLib.removeOverlaps import removeOverlaps
from fontTools.subset import Subsetter, Options
from fontTools.varLib import instancer

HERE = os.path.dirname(os.path.abspath(__file__))
args = sys.argv[1:]
FONT_SRC = args[0]


def opt(k, d):
    return args[args.index(k) + 1] if k in args else d


SAMPLES = int(opt('--samples', 48))
PX = int(opt('--px', 640))
ONLY = opt('--only', None)

# 影片用到的字（True＝朱紅描紅）
TILES = [('你', False), ('以', False), ('為', False), ('在', False), ('賺', False), ('錢', True), ('？', False),
         ('工', False), ('作', False), ('睡', False), ('覺', False), ('讓', False), ('去', False), ('上', False), ('班', False)]
if ONLY:
    TILES = [t for t in TILES if t[0] in ONLY]


# ---------- 1. 做一個粗細 900、去除重疊的小字型檔 ----------
def static_font():
    out = os.path.join(HERE, 'tiles', '_font_black.ttf')
    if os.path.exists(out):
        return out
    f = TTFont(FONT_SRC)
    o = Options()
    o.layout_features = []
    s = Subsetter(o)
    s.populate(text=''.join(c for c, _ in TILES) + '你以為在賺錢？工作睡覺讓去上班')
    s.subset(f)
    if 'fvar' in f:
        f = instancer.instantiateVariableFont(f, {'wght': 900})
    removeOverlaps(f)
    f.save(out)
    return out


# ---------- 2. 場景 ----------
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = SAMPLES
    sc.cycles.use_denoising = True
    try:
        sc.cycles.denoiser = 'OPENIMAGEDENOISE'
    except Exception:
        pass
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
    bg.inputs[0].default_value = (0.05, 0.065, 0.09, 1)   # 冷色環境光，很弱
    bg.inputs[1].default_value = 0.35
    sc.world = world
    return sc


def node(nt, kind, loc, **inputs):
    n = nt.nodes.new(kind)
    n.location = loc
    for k, v in inputs.items():
        n.inputs[k].default_value = v
    return n


def stone_material(name, base, dark, seed):
    """石頭：兩層噪聲的顏色變化＋凹凸；邊緣（Pointiness）磨亮、凹處積灰"""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = 0.88
    tex = node(nt, 'ShaderNodeTexCoord', (-1200, 0))
    mp = node(nt, 'ShaderNodeMapping', (-1000, 0))
    mp.inputs['Location'].default_value = (seed * 3.1, seed * 1.7, seed * 0.9)
    nt.links.new(tex.outputs['Object'], mp.inputs['Vector'])
    n1 = node(nt, 'ShaderNodeTexNoise', (-800, 150), Scale=6.0, Detail=12.0, Roughness=0.65)
    n2 = node(nt, 'ShaderNodeTexNoise', (-800, -150), Scale=48.0, Detail=6.0, Roughness=0.7)
    vor = node(nt, 'ShaderNodeTexVoronoi', (-800, -400), Scale=22.0)
    for n in (n1, n2, vor):
        nt.links.new(mp.outputs['Vector'], n.inputs['Vector'])
    ramp = node(nt, 'ShaderNodeValToRGB', (-550, 150))
    ramp.color_ramp.elements[0].color = dark
    ramp.color_ramp.elements[1].color = base
    ramp.color_ramp.elements[0].position = 0.35
    ramp.color_ramp.elements[1].position = 0.68
    nt.links.new(n1.outputs['Fac'], ramp.inputs['Fac'])
    # 邊緣磨亮／凹處積灰
    geo = node(nt, 'ShaderNodeNewGeometry', (-800, 400))
    pr = node(nt, 'ShaderNodeMapRange', (-550, 400))
    pr.inputs['From Min'].default_value = 0.47
    pr.inputs['From Max'].default_value = 0.56
    nt.links.new(geo.outputs['Pointiness'], pr.inputs['Value'])
    mix = node(nt, 'ShaderNodeMix', (-300, 250))
    mix.data_type = 'RGBA'
    mix.blend_type = 'MULTIPLY'
    nt.links.new(pr.outputs['Result'], mix.inputs['Factor'])
    mix.inputs['Factor'].default_value = 0.5
    nt.links.new(ramp.outputs['Color'], mix.inputs[6])
    grime = node(nt, 'ShaderNodeMix', (-450, 500))
    grime.data_type = 'RGBA'
    grime.inputs[6].default_value = (0.25, 0.22, 0.19, 1)
    grime.inputs[7].default_value = (1.05, 1.03, 1.0, 1)
    nt.links.new(pr.outputs['Result'], grime.inputs['Factor'])
    nt.links.new(grime.outputs[2], mix.inputs[7])
    mix.blend_type = 'MULTIPLY'
    nt.links.new(mix.outputs[2], bsdf.inputs['Base Color'])
    # 凹凸：大起伏＋細顆粒＋坑洞
    b1 = node(nt, 'ShaderNodeBump', (-300, -150), Strength=0.35, Distance=0.02)
    b2 = node(nt, 'ShaderNodeBump', (-100, -250), Strength=0.25, Distance=0.004)
    nt.links.new(n1.outputs['Fac'], b1.inputs['Height'])
    add = node(nt, 'ShaderNodeMath', (-450, -300))
    add.operation = 'ADD'
    nt.links.new(n2.outputs['Fac'], add.inputs[0])
    nt.links.new(vor.outputs['Distance'], add.inputs[1])
    nt.links.new(add.outputs[0], b2.inputs['Height'])
    nt.links.new(b1.outputs['Normal'], b2.inputs['Normal'])
    nt.links.new(b2.outputs['Normal'], bsdf.inputs['Normal'])
    return m


def verm_material():
    """朱紅描紅：舊顏料，局部磨掉露出石頭"""
    m = bpy.data.materials.new('verm')
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = 0.62
    tex = node(nt, 'ShaderNodeTexCoord', (-900, 0))
    n = node(nt, 'ShaderNodeTexNoise', (-700, 0), Scale=18.0, Detail=10.0, Roughness=0.7)
    nt.links.new(tex.outputs['Object'], n.inputs['Vector'])
    ramp = node(nt, 'ShaderNodeValToRGB', (-450, 0))
    ramp.color_ramp.elements[0].color = (0.30, 0.25, 0.21, 1)      # 磨掉處露出的石頭
    ramp.color_ramp.elements[1].color = (0.42, 0.028, 0.012, 1)    # 朱紅
    ramp.color_ramp.elements[0].position = 0.36
    ramp.color_ramp.elements[1].position = 0.42
    nt.links.new(n.outputs['Fac'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], bsdf.inputs['Base Color'])
    return m


def build_tile(ch, verm, font, idx):
    random.seed(1000 + idx)
    face = stone_material('stone', (0.62, 0.57, 0.49, 1), (0.36, 0.33, 0.29, 1), idx)
    groove = stone_material('groove', (0.30, 0.27, 0.24, 1), (0.16, 0.14, 0.12, 1), idx + 50)
    vm = verm_material() if verm else None

    # 石塊
    bpy.ops.mesh.primitive_cube_add(size=1)
    slab = bpy.context.object
    slab.scale = (1.0, 0.36, 1.0)            # X 寬、Y 厚、Z 高（面向 −Y 的鏡頭）
    bpy.ops.object.transform_apply(scale=True)
    bev = slab.modifiers.new('bev', 'BEVEL')
    bev.width = 0.022
    bev.segments = 3
    bpy.ops.object.modifier_apply(modifier='bev')
    slab.data.materials.append(face)

    # 崩角：在邊緣挖掉幾塊不規則的小石頭
    for k in range(7):
        edge = random.choice(['top', 'bottom', 'left', 'right'])
        u = random.uniform(-0.5, 0.5)
        pos = {'top': (u, -0.18, 0.5), 'bottom': (u, -0.18, -0.5), 'left': (-0.5, -0.18, u), 'right': (0.5, -0.18, u)}[edge]
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=random.uniform(0.025, 0.07), location=pos)
        chip = bpy.context.object
        chip.rotation_euler = (random.random() * 3, random.random() * 3, random.random() * 3)
        chip.scale = (random.uniform(0.8, 1.6), random.uniform(0.6, 1.2), random.uniform(0.8, 1.4))
        chip.data.materials.append(face)
        mod = slab.modifiers.new('chip', 'BOOLEAN')
        mod.operation = 'DIFFERENCE'
        mod.object = chip
        mod.solver = 'EXACT'
        bpy.context.view_layer.objects.active = slab
        bpy.ops.object.modifier_apply(modifier='chip')
        bpy.data.objects.remove(chip)

    # 刻字：文字轉成網格，用布林挖進石塊
    bpy.ops.object.text_add()
    tx = bpy.context.object
    tx.data.body = ch
    tx.data.font = font
    tx.data.size = 0.8
    tx.data.align_x = 'CENTER'
    tx.data.align_y = 'CENTER'
    tx.data.extrude = 0.06
    tx.data.bevel_depth = 0.012                # 讓刻痕帶斜面
    tx.data.bevel_resolution = 0
    tx.rotation_euler = (math.radians(90), 0, 0)
    tx.location = (0, -0.18 - 0.03, 0.02)
    bpy.ops.object.convert(target='MESH')
    tx = bpy.context.object
    # 文字轉出來的網格法線可能朝內，布林會變成「加上」；先統一朝外
    bpy.context.view_layer.objects.active = tx
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=0.0002)
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    tx.data.materials.append(vm if verm else groove)
    bool_mod = slab.modifiers.new('carve', 'BOOLEAN')
    bool_mod.operation = 'DIFFERENCE'
    bool_mod.object = tx
    bool_mod.solver = 'EXACT'
    try:
        bool_mod.material_mode = 'TRANSFER'
    except Exception:
        pass
    bpy.context.view_layer.objects.active = slab
    bpy.ops.object.modifier_apply(modifier='carve')
    bpy.data.objects.remove(tx)
    bpy.ops.object.shade_auto_smooth(angle=math.radians(35))
    return slab


def lights_and_camera():
    # 主光：左上前方、偏硬，讓刻痕投出清楚的陰影
    bpy.ops.object.light_add(type='AREA', location=(-1.2, -2.2, 2.6))
    key = bpy.context.object
    key.data.energy = 170
    key.data.size = 0.5
    key.data.color = (1.0, 0.95, 0.88)
    key.rotation_euler = (math.radians(40), math.radians(-18), math.radians(-25))
    # 右側冷色補光，很弱
    bpy.ops.object.light_add(type='AREA', location=(2.2, -1.6, 0.2))
    fill = bpy.context.object
    fill.data.energy = 22
    fill.data.size = 2.0
    fill.data.color = (0.7, 0.8, 1.0)
    fill.rotation_euler = (math.radians(90), 0, math.radians(55))
    # 正面正交鏡頭（2D 合成時每塊角度一致）
    bpy.ops.object.camera_add(location=(0, -4, 0), rotation=(math.radians(90), 0, 0))
    cam = bpy.context.object
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 1.08
    bpy.context.scene.camera = cam


def key_of(ch, verm):
    return ('v_' if verm else '') + format(ord(ch), 'x')


def main():
    os.makedirs(os.path.join(HERE, 'tiles'), exist_ok=True)
    fpath = static_font()
    for i, (ch, verm) in enumerate(TILES):
        t0 = time.time()
        sc = reset()
        font = bpy.data.fonts.load(fpath)
        build_tile(ch, verm, font, i)
        lights_and_camera()
        sc.render.filepath = os.path.join(HERE, 'tiles', key_of(ch, verm) + '.png')
        bpy.ops.render.render(write_still=True)
        print(f'{ch}{"（朱紅）" if verm else ""} → {key_of(ch, verm)}.png  {time.time() - t0:.1f} 秒', flush=True)


main()
