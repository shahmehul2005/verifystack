"""Tests for the fuel factor register in services/extractor/factors.py."""


def test_factor_register_and_energy_calculations():
    """Tests comprehensive fuel-to-energy factor lookups and emission formulas."""
    from services.extractor.factors import (
        get_fuel_factor,
        calculate_fuel_emissions_tco2e,
        CLINKER_CALCINATION_FACTOR,
        CEA_GRID_EMISSION_FACTOR,
    )

    # 1. Lookups
    petcoke_def = get_fuel_factor("petcoke")
    assert petcoke_def is not None
    assert petcoke_def.default_gcv == 8200.0
    assert petcoke_def.emission_factor_tj == 97.5

    imported_coal_def = get_fuel_factor("imported_coal")
    assert imported_coal_def is not None
    assert imported_coal_def.default_gcv == 5800.0

    # 2. Emissions & Energy
    # 10,000 tonnes of petcoke at 8,200 kcal/kg
    energy_tj, emissions = calculate_fuel_emissions_tco2e("petcoke", quantity=10000.0, gcv_kcal=8200.0)
    assert energy_tj > 300.0
    assert emissions > 25000.0

    # 3. Calcination & Grid factors
    assert CLINKER_CALCINATION_FACTOR == 0.525
    assert CEA_GRID_EMISSION_FACTOR == 0.716
