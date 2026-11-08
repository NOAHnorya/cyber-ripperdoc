# Blender 无界面运行：Mixamo 绑好骨的角色 FBX + 动作 FBX -> 游戏用 GLB
# - 换回原模型的材质贴图（上传 Mixamo 时去掉了贴图）
# - 每个动作 FBX 推成一条 NLA 轨道，导出成独立的 glTF 动画，名字用文件名
# 用法：Blender -b --python tools/blender_mixamo2glb.py -- character.fbx textures.glb out.glb [anim1.fbx anim2.fbx ...]
import bpy, sys, os
argv = sys.argv[sys.argv.index('--') + 1:]
char_fbx, tex_glb, out_glb, anim_fbx = argv[0], argv[1], argv[2], argv[3:]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.fbx(filepath=char_fbx, automatic_bone_orientation=False)
arm = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
char_meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
print('armature', arm.name, 'bones', len(arm.data.bones), 'meshes', len(char_meshes))
# 角色自带的动作（Mixamo 下载角色时可能带一帧 T-pose 动作）清掉，绑骨姿势就是原始 A 字姿势
if arm.animation_data:
    arm.animation_data.action = None

# 原贴图材质
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=tex_glb)
tex_objs = [o for o in bpy.data.objects if o not in before]
tex_mesh = next(o for o in tex_objs if o.type == 'MESH')
mat = tex_mesh.data.materials[0]
for m in char_meshes:
    m.data.materials.clear()
    m.data.materials.append(mat)
for o in tex_objs:
    bpy.data.objects.remove(o, do_unlink=True)

# 动作
arm.animation_data_create()
for path in anim_fbx:
    name = os.path.splitext(os.path.basename(path))[0]
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=path, automatic_bone_orientation=False)
    new_objs = [o for o in bpy.data.objects if o not in before]
    src = next((o for o in new_objs if o.type == 'ARMATURE'), None)
    act = src.animation_data.action if src and src.animation_data else None
    if act:
        act.name = name
        act.use_fake_user = True
        track = arm.animation_data.nla_tracks.new()
        track.name = name
        track.strips.new(name, int(act.frame_range[0]), act)
        print('anim', name, 'frames', tuple(act.frame_range))
    else:
        print('no action in', path)
    for o in new_objs:
        bpy.data.objects.remove(o, do_unlink=True)

bpy.ops.export_scene.gltf(
    filepath=out_glb,
    export_format='GLB',
    export_image_format='WEBP',
    export_animations=True,
    export_animation_mode='NLA_TRACKS',
    export_skins=True,
    export_def_bones=False,
    export_apply=False,
)
print('exported', out_glb, os.path.getsize(out_glb))
