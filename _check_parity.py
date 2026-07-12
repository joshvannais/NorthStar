#!/usr/bin/env python3
import os
os.chdir('/home/agent-lead/northstar-solutions')

results = {}

# A. Polaris CSS in style.css?
with open('public/css/style.css') as f:
    results['polaris_in_style_css'] = 'polaris-card' in f.read()

# B. Polaris CSS in leads.html?
with open('public/dashboard/leads.html') as f:
    leads = f.read()
    results['polaris_card_in_leads'] = 'polaris-card' in leads
    results['openDrawer_func'] = 'function openDrawer' in leads
    results['closeDrawer_func'] = 'function closeDrawer' in leads
    results['showNotification_func'] = 'function showNotification(' in leads
    results['toast_container'] = 'toastContainer' in leads
    results['closeDrawer_onclick'] = 'closeDrawer()' in leads
    results['polaris_tm'] = 'POLARIS™' in leads
    results['close_btn_x'] = '✕' in leads
    results['em_dash'] = '—' in leads
    results['extra_border'] = 'border-bottom:1px solid var(--neutral-200)' in leads

# C. updatePolaris in comms?
with open('public/dashboard/communications.html') as f:
    comms = f.read()
    results['updatePolaris_func'] = 'updatePolaris' in comms
    results['polaris_card_in_comms'] = 'polaris-card' in comms
    results['renderPolarisCard'] = 'renderPolarisCard' in comms

for k, v in results.items():
    status = '✅' if v else '❌'
    print(f'{status} {k}: {v}')