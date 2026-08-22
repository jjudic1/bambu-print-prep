"""Shared test setup.

Most of the pipeline needs a slicer's vendor profile bundle for real build
volumes. On a machine without OrcaSlicer installed (CI, a container) those tests
skip rather than fail -- but the skip is loud, because a green run that silently
tested nothing is worse than a red one.
"""

import pytest

from prep.profiles import ProfileError, profile_root


def pytest_configure(config):
    try:
        root = profile_root()
    except ProfileError:
        config._prep_profiles = None
    else:
        config._prep_profiles = root


@pytest.fixture(autouse=True)
def _require_profiles(request):
    if request.config._prep_profiles is None:
        pytest.skip("no slicer profile bundle found; set PREP_PROFILE_ROOT")


def pytest_report_header(config):
    root = config._prep_profiles
    return f"profile bundle: {root if root else 'MISSING -- profile tests will skip'}"
