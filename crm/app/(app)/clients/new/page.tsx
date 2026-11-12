import NewClientForm from "./NewClientForm";

export default function NewClientPage() {
  return (
    <div className="narrow">
      <h1>新增客戶</h1>
      <p className="muted small">先選新客戶或現有客戶，再填基本資料。客戶類別同跟進進度可以分開更新。</p>
      <NewClientForm />
    </div>
  );
}
