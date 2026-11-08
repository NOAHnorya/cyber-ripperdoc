# Blender 无界面运行：GLB -> FBX（给 Mixamo 上传用，不带贴图，控制在 10 MB 以内）
# 用法：Blender -b --python tools/blender_glb2fbx.py -- in.glb out.fbx
import bpy, sys
argv = sys.argv[sys.argv.index('--') + 1:]
src, dst = argv[0], argv[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
print('meshes', len(meshes), 'tris', sum(len(o.data.polygons) for o in meshes))
bpy.ops.export_scene.fbx(filepath=dst, use_selection=False, object_types={'MESH'}, path_mode='STRIP', embed_textures=False, apply_unit_scale=True, bake_space_transform=False, add_leaf_bones=False)
