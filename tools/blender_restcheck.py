# 比较角色 FBX 与动作 FBX 的骨骼静止姿势是否一致（不一致的话，动作套到角色上会偏）
import bpy, sys
argv = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
arms = []
for p in argv:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=p, automatic_bone_orientation=False)
    arms.append(next(o for o in bpy.data.objects if o not in before and o.type == 'ARMATURE'))
a, b = arms[0], arms[1]
for name in ['mixamorig:Hips', 'mixamorig:Spine', 'mixamorig:LeftArm', 'mixamorig:LeftForeArm', 'mixamorig:LeftUpLeg', 'mixamorig:Head']:
    ba, bb = a.data.bones.get(name), b.data.bones.get(name)
    if not ba or not bb:
        print(name, 'missing', bool(ba), bool(bb)); continue
    qa, qb = ba.matrix_local.to_quaternion(), bb.matrix_local.to_quaternion()
    ang = qa.rotation_difference(qb).angle * 57.2958
    print(f'{name:24s} restdiff {ang:6.1f} deg  headA {tuple(round(x,1) for x in ba.head_local)} headB {tuple(round(x,1) for x in bb.head_local)}')
