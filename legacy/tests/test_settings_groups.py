import copy
import unittest
from backend.settings_schema import validate_settings_groups
from backend.mio_library import LibraryError, share_document


class SettingsGroupsTests(unittest.TestCase):
    def example(self):
        return {'id': 'preset', 'title': '光影', 'settingsGroups': [{'id': 'lighting', 'title': '镜头与光影'}],
                'entries': [{'id': 'light', 'key': 'light', 'type': 'text', 'value': 'soft', 'groupId': 'lighting'}]}

    def test_valid_groups_do_not_change_values(self):
        doc = self.example(); before = copy.deepcopy(doc)
        self.assertEqual(validate_settings_groups(doc), before)

    def test_share_keeps_groups_and_membership(self):
        doc = self.example(); shared = share_document('characters', doc)
        self.assertEqual(shared['settingsGroups'], doc['settingsGroups'])
        self.assertEqual(shared['entries'][0]['groupId'], 'lighting')
        shared['settingsGroups'][0]['title'] = '另一份副本'
        self.assertEqual(doc['settingsGroups'][0]['title'], '镜头与光影')

    def test_rejects_invalid_definitions(self):
        for groups in ({}, [None], [{'id': 'x', 'title': ''}], [{'id': 'x', 'title': 'a'}]*2,
                       [{'id': 'x', 'title': 'a'}, {'id': 'y', 'title': 'a'}],
                       [{'id': 'x', 'title': '长'*61}], [{'id': 'x', 'title': 'a'}]*129):
            with self.subTest(groups=groups), self.assertRaises(LibraryError):
                validate_settings_groups({'settingsGroups': groups})

    def test_empty_and_ungrouped_are_valid(self):
        self.assertEqual(validate_settings_groups({'settingsGroups': [], 'variables': []})['settingsGroups'], [])
        doc = self.example(); doc['entries'][0]['groupId'] = ''
        validate_settings_groups(doc)
