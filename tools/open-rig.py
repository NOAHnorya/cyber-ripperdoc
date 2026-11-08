"""Clear the standing space between the wrist clamps on the selected Hi3D rig."""
import sys
import bpy

source, destination = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=source, merge_vertices=True)
frame = next(obj for obj in bpy.context.scene.objects if obj.type == "MESH")
bpy.ops.mesh.primitive_cube_add(size=1, location=(0,0,.012))
cutter = bpy.context.object
cutter.dimensions = (.16, 1.2, .10)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
bpy.context.view_layer.objects.active = frame
modifier = frame.modifiers.new("Clear wrist crossbar", "BOOLEAN")
modifier.operation = "DIFFERENCE"
modifier.solver = "EXACT"
modifier.object = cutter
bpy.ops.object.modifier_apply(modifier=modifier.name)
bpy.data.objects.remove(cutter, do_unlink=True)
triangulate = frame.modifiers.new("Triangulate caps", "TRIANGULATE")
bpy.ops.object.modifier_apply(modifier=triangulate.name)
reducer = frame.modifiers.new("Game mesh", "DECIMATE")
reducer.ratio = min(1.0, 39000 / len(frame.data.polygons))
bpy.ops.object.modifier_apply(modifier=reducer.name)
bpy.ops.export_scene.gltf(filepath=destination, export_format="GLB", export_animations=False)
