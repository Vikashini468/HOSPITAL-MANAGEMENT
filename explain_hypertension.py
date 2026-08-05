import joblib
import pandas as pd
import shap

# ============================================================
# LOAD MODEL
# ============================================================

pipeline = joblib.load("hypertension_risk_model.pkl")

# ============================================================
# SAMPLE PATIENT
# ============================================================

patient = {

    "age":55,
    "gender":"Male",

    "bmi":31.2,

    "systolic_bp":150,
    "diastolic_bp":96,
    "heart_rate":88,

    "total_cholesterol_mg_dl":225,
    "hdl_mg_dl":42,
    "ldl_mg_dl":145,
    "triglycerides_mg_dl":210,

    "creatinine_mg_dl":1.1,

    "family_history_hypertension":"Yes",

    "smoking":"Former",
    "alcohol":"Occasionally",
    "physical_activity":"Low",
    "diet_quality":"Poor",

    "sleep_hours":5.5,

    "headache":1,
    "dizziness":1,
    "chest_pain":0,
    "breathlessness":0

}

patient_df = pd.DataFrame([patient])

# ============================================================
# PREPROCESS DATA
# ============================================================

preprocessor = pipeline.named_steps["preprocessor"]
model = pipeline.named_steps["model"]

X_processed = preprocessor.transform(patient_df)

# ============================================================
# SHAP EXPLAINER
# ============================================================

explainer = shap.TreeExplainer(model)

shap_values = explainer.shap_values(X_processed)

# ============================================================
# FEATURE NAMES
# ============================================================

feature_names = preprocessor.get_feature_names_out()

# ============================================================
# CONTRIBUTION
# ============================================================

importance = pd.DataFrame({

    "Feature":feature_names,
    "SHAP Value":shap_values[0]

})

importance["Absolute"] = importance["SHAP Value"].abs()

importance = importance.sort_values(
    by="Absolute",
    ascending=False
)

# ============================================================
# DISPLAY
# ============================================================

print("\n======================================")
print("TOP FEATURES AFFECTING PREDICTION")
print("======================================")

print(
    importance[
        ["Feature","SHAP Value"]
    ].head(10)
)