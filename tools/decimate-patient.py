"""Use Blender's edge collapse on a welded surface so UV seams stay closed."""
import sys
import bpy

source, destination = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=source, merge_vertices=True)
meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
face_count = sum(len(obj.data.polygons) for obj in meshes)
target = 76000 if source.endswith("daoba_raw.glb") else 76500
for obj in meshes:
    bpy.context.view_layer.objects.active = obj
    modifier = obj.modifiers.new("Preserve closed surface", "DECIMATE")
    modifier.ratio = min(1.0, target / face_count)
    bpy.ops.object.modifier_apply(modifier=modifier.name)
bpy.ops.export_scene.gltf(filepath=destination, export_format="GLB", export_animations=False)
