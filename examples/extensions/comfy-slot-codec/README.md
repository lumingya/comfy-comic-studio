# ComfyUI LoRA slot codec example

This extension describes an illustrative `ExamplePackedModel` node whose
`packed_adapters` input contains a JSON array of LoRA names, weights and switches.
It is an offline example and does not install a ComfyUI node.

Import and enable the extension in Mio. Import an API workflow containing the
example shape with its MODEL output connected. Check the group's adapter identity
and individual keys at `GET /api/v2/workflows/{id}/loras`. Pass those keys in
`slot_overrides.groups` to compile or trial the workflow.
