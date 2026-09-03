function OnStoredInstance(instanceId, tags, metadata, origin)
  -- Only process instances that come from outside (DICOM protocol or REST),
  -- not the instances re-uploaded by this very script, to avoid infinite loops.
  if origin['RequestOrigin'] ~= 'Lua' then
    local institution = tags['InstitutionName'] or ''
    local description = tags['StudyDescription'] or ''

    if institution ~= '' and description == '' then
      local command = {}
      command['Replace'] = { StudyDescription = institution }
      -- Preserve the original DICOM identifiers (otherwise Orthanc would
      -- generate new StudyInstanceUID / SeriesInstanceUID / SOPInstanceUID).
      command['Keep'] = { 'StudyInstanceUID', 'SeriesInstanceUID', 'SOPInstanceUID' }
      command['Force'] = true

      -- Produce a modified DICOM file that keeps the same identifiers
      local modifiedFile = RestApiPost('/instances/' .. instanceId .. '/modify',
                                       DumpJson(command, true))

      -- Replace the original instance with the modified one
      RestApiDelete('/instances/' .. instanceId)
      RestApiPost('/instances/', modifiedFile)
    end
  end
end
