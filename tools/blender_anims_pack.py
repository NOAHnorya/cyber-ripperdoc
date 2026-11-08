# Blender 无界面：多个 Mixamo 动作 FBX（Without Skin）-> 一个只有骨骼 + 动画的 GLB
# 动作 FBX 的静止姿势是 T 字，角色是 A 字；所以每个动作都挂在它自己的骨架上导出，
# glTF 里存的就是骨骼的绝对局部旋转，运行时按骨骼名套到任何 Mixamo 角色上都对。
# （动作可能来自不同角色的骨架，所以不能把动作挪到同一副骨架上）
# 用法：Blender -b --python tools/blender_anims_pack.py -- out.glb anim1.fbx anim2.fbx ...
import bpy, sys, os
argv = sys.argv[sys.argv.index('--') + 1:]
out_glb, anim_fbx = argv[0], argv[1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
for path in anim_fbx:
    name = os.path.splitext(os.path.basename(path))[0]
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=path, automatic_bone_orientation=False)
    new_objs = [o for o in bpy.data.objects if o not in before]
    arm = next(o for o in new_objs if o.type == 'ARMATURE')
    arm.name = 'rig_' + name
    act = arm.animation_data.action
    act.name = name
    act.use_fake_user = True
    arm.animation_data.action = None
    track = arm.animation_data.nla_tracks.new()
    track.name = name
    track.strips.new(name, int(act.frame_range[0]), act)
    print('anim', name, 'frames', tuple(act.frame_range), 'bones', len(arm.data.bones))
    for o in new_objs:
        if o is not arm:
            bpy.data.objects.remove(o, do_unlink=True)
bpy.ops.export_scene.gltf(
    filepath=out_glb,
    export_format='GLB',
    export_animations=True,
    export_animation_mode='NLA_TRACKS',
    export_def_bones=False,
)
print('exported', out_glb, os.path.getsize(out_glb))
