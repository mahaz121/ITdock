'use client';

import { useEffect, useState } from 'react';

export default function CustodyFormsPage({ user, api }) {
  const [data, setData] = useState({ forms: [], employees: [], assets: [], companies: [] });
  const [draft, setDraft] = useState({ employee_id: '', asset_id: '', company_id: '', cost: '', currency: 'SAR' });
  const [tpl, setTpl] = useState({ title_en: 'Asset Custody Form', title_ar: 'نموذج عهدة أصول', terms_en: '', terms_ar: '' });
  const canManage = ['super_admin', 'it_admin'].includes(user.role);
  const isAdmin = user.role === 'super_admin';

  const load = async () => {
    const [forms, employees, assets, companies, template] = await Promise.all([
      api.get('custody/forms'),
      api.get('employees?lightweight=true'),
      api.get('assets?status=In Stock&lightweight=true'),
      api.get('companies'),
      api.get('custody/template'),
    ]);
    setData({
      forms,
      employees,
      assets: assets.filter(asset => !asset.assigned_to && ['In Stock', 'Available'].includes(asset.status)),
      companies,
    });
    setTpl(template);
  };

  useEffect(() => { load(); }, []);

  const esc = value => String(value || '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));

  const pdf = form => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    const employeeIdLine = form.employee.id_number
      ? `ID/Iqama: ${esc(form.employee.id_number)}<br>`
      : '';
    const employeeIdLineAr = form.employee.id_number
      ? `رقم الهوية/الإقامة: ${esc(form.employee.id_number)}<br>`
      : '';

    printWindow.document.write(`<!doctype html>
      <html>
        <head>
          <meta charset="utf-8">
          <title>${esc(form.reference)}</title>
          <style>
            @page { size: A4; margin: 8mm 10mm 10mm; }
            * { box-sizing: border-box; }
            body { margin: 0; font: 11.5px Arial, sans-serif; color: #18212b; }
            .head { position: relative; min-height: 50px; padding: 5px 105px 8px; text-align: center; border-bottom: 3px solid #0d9488; }
            .logo { position: absolute; top: 0; left: 0; max-width: 105px; max-height: 44px; object-fit: contain; object-position: left top; }
            .reference { position: absolute; top: 1px; right: 0; font-size: 10px; font-weight: 700; color: #52606d; }
            .head h1 { margin: 10px 0 0; font-size: 17px; line-height: 1.25; }
            .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
            .box { margin-top: 8px; padding: 9px; border: 1px solid #ccd4dc; border-radius: 6px; break-inside: avoid; }
            .box h3 { margin: 0 0 7px; font-size: 13px; }
            .employee { line-height: 1.4; }
            .ar { direction: rtl; text-align: right; }
            .asset-grid { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 7px; }
            .detail { padding: 6px 7px; background: #f6f8fa; border-radius: 4px; min-width: 0; }
            .detail-label { display: block; margin-bottom: 2px; color: #65727f; font-size: 9px; font-weight: 700; text-transform: uppercase; }
            .detail-value { display: block; overflow-wrap: anywhere; font-weight: 600; }
            .serial { grid-column: span 2; background: #eaf8f6; border: 1px solid #9ddbd3; }
            .serial .detail-value { color: #075f58; font-size: 12.5px; font-weight: 800; }
            .specifications { margin-top: 7px; padding-top: 7px; border-top: 1px solid #dde3e8; line-height: 1.4; }
            .terms { white-space: pre-wrap; line-height: 1.45; font-size: 10.5px; }
            .sign { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 18px; margin-top: 32px; }
            .line { padding-top: 6px; border-top: 1px solid #18212b; }
          </style>
        </head>
        <body>
          <header class="head">
            ${form.company.logo ? `<img class="logo" src="${esc(form.company.logo)}" alt="Company logo">` : ''}
            <span class="reference">${esc(form.reference)}</span>
            <h1>${esc(form.template.title_en)} | ${esc(form.template.title_ar)}</h1>
          </header>
          <div class="grid">
            <section class="box employee">
              <h3>Employee Information</h3>
              Name: ${esc(form.employee.name)}<br>
              Employee No: ${esc(form.employee.employee_id)}<br>
              ${employeeIdLine}
              Designation: ${esc(form.employee.designation)}<br>
              Project: ${esc(form.employee.project)}<br>
              Department: ${esc(form.employee.department)}
            </section>
            <section class="box employee ar">
              <h3>بيانات الموظف</h3>
              الاسم: ${esc(form.employee.name)}<br>
              الرقم الوظيفي: ${esc(form.employee.employee_id)}<br>
              ${employeeIdLineAr}
              المسمى الوظيفي: ${esc(form.employee.designation)}<br>
              المشروع: ${esc(form.employee.project)}<br>
              القسم: ${esc(form.employee.department)}
            </section>
          </div>
          <section class="box">
            <h3>Asset Details | تفاصيل الأصل</h3>
            <div class="asset-grid">
              <div class="detail"><span class="detail-label">Asset Tag</span><span class="detail-value">${esc(form.asset.asset_tag)}</span></div>
              <div class="detail"><span class="detail-label">Type</span><span class="detail-value">${esc(form.asset.category)}</span></div>
              <div class="detail"><span class="detail-label">Brand / Model</span><span class="detail-value">${esc(`${form.asset.brand || ''} ${form.asset.model || ''}`.trim()) || '-'}</span></div>
              <div class="detail serial"><span class="detail-label">Serial Number</span><span class="detail-value">${esc(form.asset.serial_number) || 'Not recorded'}</span></div>
              <div class="detail"><span class="detail-label">Cost</span><span class="detail-value">${esc(form.cost)} ${esc(form.currency)}</span></div>
            </div>
            ${form.asset.specifications ? `<div class="specifications"><strong>Specifications:</strong> ${esc(form.asset.specifications)}</div>` : ''}
          </section>
          <div class="grid">
            <section class="box terms"><h3>Acknowledgement</h3>${esc(form.template.terms_en)}</section>
            <section class="box terms ar"><h3>إقرار استلام عهدة</h3>${esc(form.template.terms_ar)}</section>
          </div>
          <footer class="sign">
            <div class="line">Employee signature / date</div>
            <div class="line">Generated by: ${esc(form.generated_by)}</div>
            <div class="line">Company stamp</div>
          </footer>
          <script>onload=()=>print()<\/script>
        </body>
      </html>`);
    printWindow.document.close();
  };

  const field = { background: '#111722', border: '1px solid #303846', borderRadius: 8, padding: 10, color: 'white' };

  return (
    <div className="p-8 space-y-6">
      <h1 className="text-2xl font-bold">Custody Forms</h1>
      {canManage && (
        <section className="p-5 rounded-xl grid grid-cols-2 gap-3" style={{ background: '#10151f' }}>
          {[
            ['employee_id', data.employees, 'Employee'],
            ['asset_id', data.assets, 'Unassigned stock asset'],
            ['company_id', data.companies, 'Company'],
          ].map(([key, list, label]) => (
            <select key={key} style={field} value={draft[key]} onChange={event => setDraft({ ...draft, [key]: event.target.value })}>
              <option value="">{label}</option>
              {list.map(item => <option key={item.id} value={item.id}>{item.name || item.asset_tag}</option>)}
            </select>
          ))}
          <div className="flex gap-2">
            <input style={field} placeholder="Cost" value={draft.cost} onChange={event => setDraft({ ...draft, cost: event.target.value })} />
            <input style={field} value={draft.currency} onChange={event => setDraft({ ...draft, currency: event.target.value })} />
          </div>
          <button className="p-2 bg-teal-600 rounded" onClick={async () => { await api.post('custody/forms', draft); await load(); }}>Generate Draft</button>
        </section>
      )}
      {isAdmin && (
        <section className="p-5 rounded-xl grid grid-cols-2 gap-3" style={{ background: '#10151f' }}>
          <input style={field} value={tpl.title_en} onChange={event => setTpl({ ...tpl, title_en: event.target.value })} />
          <input dir="rtl" style={field} value={tpl.title_ar} onChange={event => setTpl({ ...tpl, title_ar: event.target.value })} />
          <textarea style={field} rows="8" value={tpl.terms_en} onChange={event => setTpl({ ...tpl, terms_en: event.target.value })} />
          <textarea dir="rtl" style={field} rows="8" value={tpl.terms_ar} onChange={event => setTpl({ ...tpl, terms_ar: event.target.value })} />
          <button className="p-2 bg-teal-600 rounded" onClick={() => api.put('custody/template', tpl)}>Save Template</button>
        </section>
      )}
      <div className="space-y-2">
        {data.forms.map(form => (
          <div key={form.id} className="p-4 rounded-xl flex justify-between" style={{ background: '#10151f' }}>
            <span>{form.reference} · {form.employee.name} · {form.asset.asset_tag} · {form.status}</span>
            <span className="space-x-2">
              <button onClick={() => pdf(form)}>PDF</button>
              {canManage && form.status !== 'Assigned' && <button onClick={async () => { await api.put(`custody/forms/${form.id}/assign`, {}); await load(); }}>Assign Asset</button>}
              {canManage && form.status !== 'Assigned' && <button className="text-red-400" onClick={async () => { await api.delete(`custody/forms/${form.id}`); await load(); }}>Delete</button>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
