# Ari face correction — eyes fixed to the head

The previous facial makeover placed replacement 3D eyes and a nose on a separate bone-attached group. In real gameplay the eyes visibly detached from the head and floated nearby. This release **removes that approach entirely**.

- **Original 3D eyes retained:** The two original eye islands in `Mage_Head` are UV-mapped in place with a warm-white sclera, brown irises, smaller dark pupils and subtle highlights. The eyes remain part of the same `SkinnedMesh` and use the exact original skeleton and animation transforms.
- **Original eyebrows retained and softened:** Existing eyebrow islands are slightly thinner and dark brown, not separate floating tubes.
- **Original nose retained:** The pointed original nose is preserved for anatomical continuity. No added floating nose mesh.
- **One animated mouth:** The earlier `mouthRig.js` remains responsible for neutralising the original painted mouth and driving a single lip-synced replacement mouth.
- **No camera, story, voice, puzzle, checkpoint or level changes.**

Technical safeguards: fail-closed eye/brow island identification, no replacement face objects, all new face styling is within the original skinned head geometry. The same head material's existing skinning is preserved.

## Testing

Source/module syntax, mesh-island identification, single-skinned-head material groups, static release and archive integrity can be checked automatically. **Real-time visual playback must still be reviewed on the target computer before Moodle submission.**
