import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Empty, Form, Input, Modal, Select, Space, Table, Tag, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import { ReactFlow, Background, Controls, MiniMap, Handle, Position, applyNodeChanges, MarkerType } from '@xyflow/react';
import type { Connection, Node, NodeChange } from '@xyflow/react';
import { Plus, Redo2, Search, Trash2, Undo2, X } from 'lucide-react';
import { modelIri, STUDIO_HISTORY_LIMIT } from '@sudowork/ontology-common';
import type { IOntologyConsistencyIssue, IOntologyStudioModel, IOntologyObjectDraft, IOntologyAttributeDraft, IOntologyRelationDraft, IOntologySemanticDocument } from '@sudowork/ontology-common';
import '@xyflow/react/dist/style.css';
import styles from './studio.module.css';

interface IOntologyNodeData extends Record<string, unknown> {
  name: string;
  attributes: number;
  isChanged?: boolean;
  onSelect: () => void;
}
const nodeTypes = { ontology: OntologyNode };

function OntologyNode({ data }: IOntologyNodeProps) {
  const { t } = useTranslation();
  return (
    <div className={`${styles['ontology-node']} ${data.isChanged ? styles['ontology-node-changed'] : ''}`}>
      <Handle type='target' position={Position.Left} />
      <Button type='text' className={styles['ontology-node-button']} onClick={data.onSelect}>
        <span className={styles['ontology-node-content']}>
          <span className={styles['ontology-node-name']}>{data.name}</span>
          <span className={styles['ontology-node-meta']}>{t('ontology.studio.attributeCount', { count: data.attributes })}</span>
        </span>
      </Button>
      <Handle type='source' position={Position.Right} />
    </div>
  );
}

export default function StudioModelEditor({ workspaceId, model, document, onChange, onContext, onEditingChange, focusObjectId, focusIssue }: IStudioModelEditorProps) {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string>();
  const [view, setView] = useState<'graph' | 'structure'>('graph');
  const [search, setSearch] = useState('');
  const [nodes, setNodes] = useState<Node<IOntologyNodeData>[]>([]);
  const positionsRef = useRef<Record<string, { x: number; y: number }>>({});
  const [objectEditor, setObjectEditor] = useState<IOntologyObjectDraft | 'new'>();
  const [attributeEditor, setAttributeEditor] = useState<IOntologyAttributeDraft | 'new'>();
  const [relationEditor, setRelationEditor] = useState<IOntologyRelationDraft>();
  const [history, setHistory] = useState<IOntologyStudioModel[]>([structuredClone(model)]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const localModel = useRef(JSON.stringify(model));
  const [objectForm] = Form.useForm();
  const [attributeForm] = Form.useForm();
  const [relationForm] = Form.useForm();
  const lastFocusIssue = useRef<IOntologyConsistencyIssue | undefined>(undefined);
  const selected = model.objects.find((object) => object.id === selectedId);
  const label = useCallback((key: string) => t(`ontology.studio.${key}`), [t]);

  useEffect(() => {
    try {
      positionsRef.current = JSON.parse(localStorage.getItem(`ontology-studio:layout:${workspaceId}`) || '{}');
    } catch {
      positionsRef.current = {};
    }
  }, [workspaceId]);
  useEffect(() => {
    if (JSON.stringify(model) !== localModel.current) {
      setHistory([structuredClone(model)]);
      setHistoryIndex(0);
      localModel.current = JSON.stringify(model);
    }
  }, [model]);
  useEffect(() => {
    setNodes((previous) =>
      model.objects.map((object, index) => ({
        id: object.id,
        type: 'ontology',
        position: previous.find((node) => node.id === object.id)?.position || positionsRef.current[object.id] || { x: (index % 3) * 270, y: Math.floor(index / 3) * 170 },
        selected: object.id === selectedId,
        data: {
          name: object.name,
          attributes: object.attributes.length,
          isChanged: previous.length > 0 && (!previous.some((node) => node.id === object.id) || previous.find((node) => node.id === object.id)?.data.name !== object.name || previous.find((node) => node.id === object.id)?.data.attributes !== object.attributes.length),
          onSelect: () => setSelectedId(object.id),
        },
        style: search && !`${object.name} ${object.code} ${object.iri}`.toLowerCase().includes(search.toLowerCase()) ? { opacity: 0.3 } : undefined,
      }))
    );
  }, [model.objects, selectedId, search]);
  const edges = useMemo(
    () =>
      model.relations.map((relation) => ({
        id: relation.id,
        source: relation.fromObjectId,
        target: relation.toObjectId,
        label: relation.semanticType === 'inheritance' ? t('ontology.studio.inheritance') : relation.name,
        type: relation.fromObjectId === relation.toObjectId ? 'smoothstep' : 'default',
        markerEnd: { type: MarkerType.ArrowClosed },
        style: relation.semanticType === 'inheritance' ? { strokeDasharray: '5 4' } : undefined,
      })),
    [model.relations, t]
  );
  const onEdit = (next: IOntologyStudioModel) => {
    const items = [...history.slice(0, historyIndex + 1), structuredClone(next)].slice(-STUDIO_HISTORY_LIMIT);
    setHistory(items);
    setHistoryIndex(items.length - 1);
    localModel.current = JSON.stringify(next);
    onChange(next);
  };
  const onHistory = (index: number) => {
    if (!history[index]) return;
    setHistoryIndex(index);
    const next = structuredClone(history[index]);
    localModel.current = JSON.stringify(next);
    onChange(next);
  };
  const onOpenObject = (object?: IOntologyObjectDraft) => {
    objectForm.resetFields();
    objectForm.setFieldsValue(object || { name: '', description: '' });
    setObjectEditor(object || 'new');
  };
  const onSaveObject = async () => {
    const values = await objectForm.validate();
    const prior = objectEditor !== 'new' ? objectEditor : undefined;
    const id = prior?.id || crypto.randomUUID();
    const next: IOntologyObjectDraft = {
      id,
      iri: prior?.iri || modelIri(workspaceId, id),
      code: prior?.code || `object_${id.slice(0, 8)}`,
      name: values.name.trim(),
      description: values.description || '',
      tier: 1,
      status: 'active',
      sourceAssetIds: [],
      attributes: [],
      reviewDecision: 'pending',
      ...prior,
      ...values,
      updatedAt: Date.now(),
    };
    onEdit({ ...model, objects: prior ? model.objects.map((item) => (item.id === id ? next : item)) : [...model.objects, next] });
    setSelectedId(id);
    setObjectEditor(undefined);
  };
  const onOpenAttribute = (attribute?: IOntologyAttributeDraft) => {
    attributeForm.resetFields();
    attributeForm.setFieldsValue(attribute ? { ...attribute, isIdentifier: attribute.isIdentifier ? 'yes' : 'no' } : { name: '', dataType: 'string', required: false });
    setAttributeEditor(attribute || 'new');
  };
  const onSaveAttribute = async () => {
    if (!selected) return;
    const values = await attributeForm.validate();
    const prior = attributeEditor !== 'new' ? attributeEditor : undefined;
    const id = prior?.id || crypto.randomUUID();
    const attribute: IOntologyAttributeDraft = { ...prior, ...values, id, iri: prior?.iri || modelIri(workspaceId, id), code: values.code?.trim() || prior?.code || `field_${id.slice(0, 8)}`, required: values.required === true, isIdentifier: values.isIdentifier === 'yes' };
    const attributes = prior ? selected.attributes.map((item) => (item.id === id ? attribute : item)) : [...selected.attributes, attribute];
    onEdit({ ...model, objects: model.objects.map((item) => (item.id === selected.id ? { ...item, attributes, updatedAt: Date.now() } : item)) });
    setAttributeEditor(undefined);
  };
  const onOpenRelation = (relation: IOntologyRelationDraft) => {
    relationForm.resetFields();
    relationForm.setFieldsValue(relation);
    setRelationEditor(relation);
  };
  const onConnect = (connection: Connection) => {
    if (!connection.source || !connection.target) return;
    const id = crypto.randomUUID();
    onOpenRelation({
      id,
      iri: modelIri(workspaceId, id),
      code: `relation_${id.slice(0, 8)}`,
      name: '',
      fromObjectId: connection.source,
      toObjectId: connection.target,
      cardinality: 'unspecified',
      relationType: 'object_property',
      semanticType: 'association',
      isAcyclic: false,
      reviewDecision: 'pending',
      updatedAt: Date.now(),
    });
  };
  const onSaveRelation = async () => {
    if (!relationEditor) return;
    const values = await relationForm.validate();
    const relation = { ...relationEditor, ...values, updatedAt: Date.now() };
    const isExisting = model.relations.some((item) => item.id === relation.id);
    onEdit({ ...model, relations: isExisting ? model.relations.map((item) => (item.id === relation.id ? relation : item)) : [...model.relations, relation] });
    setRelationEditor(undefined);
  };
  const onDeleteObject = () => {
    if (!selected) return;
    Modal.confirm({
      title: label('deleteObject'),
      content: label('deleteObjectHint'),
      onOk: () => {
        onEdit({ objects: model.objects.filter((item) => item.id !== selected.id), relations: model.relations.filter((item) => item.fromObjectId !== selected.id && item.toObjectId !== selected.id) });
        setSelectedId(undefined);
      },
    });
  };
  const onNodesChange = (changes: NodeChange<Node<IOntologyNodeData>>[]) => setNodes((current) => applyNodeChanges(changes, current));
  const onPersistLayout = () => {
    positionsRef.current = Object.fromEntries(nodes.map((node) => [node.id, node.position]));
    localStorage.setItem(`ontology-studio:layout:${workspaceId}`, JSON.stringify(positionsRef.current));
  };
  const onLayout = () => {
    setNodes((current) => current.map((node, i) => ({ ...node, position: { x: (i % 3) * 270, y: Math.floor(i / 3) * 170 } })));
    positionsRef.current = {};
    localStorage.removeItem(`ontology-studio:layout:${workspaceId}`);
  };
  const isObjectModalOpen = objectEditor !== undefined;
  const isAttributeModalOpen = attributeEditor !== undefined;
  useEffect(() => {
    onEditingChange(isObjectModalOpen || isAttributeModalOpen || !!relationEditor);
    return () => onEditingChange(false);
  }, [isObjectModalOpen, isAttributeModalOpen, relationEditor, onEditingChange]);
  useEffect(() => {
    if (focusObjectId) setSelectedId(focusObjectId);
  }, [focusObjectId]);
  useEffect(() => {
    if (!focusIssue || focusIssue === lastFocusIssue.current) return;
    lastFocusIssue.current = focusIssue;
    if (focusIssue.targetType === 'relation') {
      const relation = model.relations.find((item) => item.id === focusIssue.targetId);
      if (relation) {
        relationForm.resetFields();
        relationForm.setFieldsValue(relation);
        setRelationEditor(relation);
      }
    }
  }, [focusIssue, model.relations, relationForm]);

  return (
    <section
      className={styles['ontology-model-editor']}
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !(event.target as HTMLElement).closest('input,textarea,[contenteditable]')) {
          event.preventDefault();
          onHistory(historyIndex + (event.shiftKey ? 1 : -1));
        }
      }}
    >
      <div className={styles['ontology-toolbar']}>
        <Space>
          <Button type={view === 'graph' ? 'primary' : 'text'} onClick={() => setView('graph')}>
            {label('graph')}
          </Button>
          <Button type={view === 'structure' ? 'primary' : 'text'} onClick={() => setView('structure')}>
            {label('structure')}
          </Button>
        </Space>
        <Space wrap>
          <Input aria-label={label('searchModel')} placeholder={label('searchModel')} prefix={<Search size={14} />} value={search} onChange={setSearch} style={{ width: 160 }} />
          <Button icon={<Undo2 size={16} />} aria-label={label('undo')} disabled={historyIndex === 0} onClick={() => onHistory(historyIndex - 1)} />
          <Button icon={<Redo2 size={16} />} aria-label={label('redo')} disabled={historyIndex === history.length - 1} onClick={() => onHistory(historyIndex + 1)} />
          <Button onClick={onLayout}>{label('layout')}</Button>
          <Button type='primary' icon={<Plus size={14} />} onClick={() => onOpenObject()}>
            {label('addObject')}
          </Button>
          <Button disabled={!model.objects.length} onClick={() => onConnect({ source: selectedId || model.objects[0]?.id, target: model.objects[1]?.id || model.objects[0]?.id, sourceHandle: null, targetHandle: null })}>
            {label('addRelation')}
          </Button>
        </Space>
      </div>
      <div className={styles['ontology-canvas-area']}>
        <div className={styles['ontology-canvas']}>
          {view === 'graph' ? (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodesChange={onNodesChange}
              onNodeDragStop={onPersistLayout}
              onNodeClick={(_event, node) => setSelectedId(node.id)}
              onNodeDoubleClick={(_event, node) => onOpenObject(model.objects.find((item) => item.id === node.id))}
              onEdgeClick={(_event, edge) => {
                const relation = model.relations.find((item) => item.id === edge.id);
                if (relation) onOpenRelation(relation);
              }}
              onConnect={onConnect}
              fitView
              minZoom={0.15}
              maxZoom={2}
              deleteKeyCode={null}
              colorMode='system'
            >
              <Background />
              <Controls showInteractive={false} aria-label={label('graphControls')} />
              {nodes.length > 8 && <MiniMap pannable zoomable />}
              {!model.objects.length && (
                <div className={styles['ontology-canvas-empty']}>
                  <Empty description={label('emptyModel')} />
                  <Button type='primary' onClick={() => onOpenObject()}>
                    {label('addObject')}
                  </Button>
                </div>
              )}
            </ReactFlow>
          ) : (
            <div className={styles['ontology-structure']}>
              <Table
                rowKey='id'
                data={model.objects.filter((item) => `${item.name} ${item.iri}`.toLowerCase().includes(search.toLowerCase()))}
                columns={[
                  {
                    title: label('name'),
                    dataIndex: 'name',
                    render: (_value, record) => (
                      <Button type='text' onClick={() => setSelectedId(record.id)}>
                        {record.name}
                      </Button>
                    ),
                  },
                  { title: 'IRI', dataIndex: 'iri' },
                  { title: label('attributes'), render: (_value, record) => record.attributes.length },
                ]}
              />
              <Typography.Title heading={6}>{label('relations')}</Typography.Title>
              <Table
                rowKey='id'
                data={model.relations}
                columns={[
                  {
                    title: label('name'),
                    render: (_value, record) => (
                      <Button type='text' onClick={() => onOpenRelation(record)}>
                        {record.name}
                      </Button>
                    ),
                  },
                  { title: label('from'), render: (_value, record) => model.objects.find((item) => item.id === record.fromObjectId)?.name },
                  { title: label('to'), render: (_value, record) => model.objects.find((item) => item.id === record.toObjectId)?.name },
                ]}
              />
              <Typography.Text type='secondary'>{label('preservedAxioms')}</Typography.Text>
              <pre className={styles['ontology-code']}>{JSON.stringify(document?.statements || [], null, 2)}</pre>
            </div>
          )}
        </div>
        {selected && (
          <aside className={styles['ontology-inspector']}>
            <div className={styles['ontology-toolbar']}>
              <Typography.Title heading={6}>{selected.name}</Typography.Title>
              <Button type='text' icon={<X size={16} />} aria-label={label('close')} onClick={() => setSelectedId(undefined)} />
            </div>
            <div className={styles['ontology-inspector-content']}>
              <p>{selected.description}</p>
              <Space wrap>
                <Button onClick={() => onOpenObject(selected)}>{label('edit')}</Button>
                <Button onClick={() => onContext(selected.id)}>{label('addContext')}</Button>
                <Button status='danger' icon={<Trash2 size={14} />} onClick={onDeleteObject}>
                  {label('delete')}
                </Button>
              </Space>
              <div className={styles['ontology-section-heading']}>
                <Typography.Title heading={6}>{label('attributes')}</Typography.Title>
                <Button type='text' icon={<Plus size={14} />} onClick={() => onOpenAttribute()}>
                  {label('add')}
                </Button>
              </div>
              {selected.attributes.map((attribute) => (
                <div className={styles['ontology-attribute']} key={attribute.id}>
                  <Button type='text' onClick={() => onOpenAttribute(attribute)}>
                    {attribute.name}
                  </Button>
                  <Tag>{attribute.dataType}</Tag>
                  <Button
                    type='text'
                    status='danger'
                    aria-label={`${label('delete')} ${attribute.name}`}
                    onClick={() => onEdit({ ...model, objects: model.objects.map((item) => (item.id === selected.id ? { ...item, attributes: item.attributes.filter((attr) => attr.id !== attribute.id) } : item)) })}
                  >
                    <Trash2 size={13} />
                  </Button>
                </div>
              ))}
            </div>
          </aside>
        )}
      </div>
      <Modal title={label(objectEditor === 'new' ? 'addObject' : 'editObject')} visible={isObjectModalOpen} onCancel={() => setObjectEditor(undefined)} onOk={onSaveObject} unmountOnExit>
        <Form form={objectForm} layout='vertical'>
          <Form.Item field='name' label={label('name')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item field='description' label={label('description')}>
            <Input.TextArea />
          </Form.Item>
        </Form>
      </Modal>
      <Modal title={label('editAttribute')} visible={isAttributeModalOpen} onCancel={() => setAttributeEditor(undefined)} onOk={onSaveAttribute} unmountOnExit>
        <Form form={attributeForm} layout='vertical'>
          <Form.Item field='name' label={label('name')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item field='code' label={label('code')}>
            <Input />
          </Form.Item>
          <Form.Item field='dataType' label={label('dataType')} rules={[{ required: true }]}>
            <Select allowCreate options={['string', 'integer', 'decimal', 'double', 'boolean', 'date', 'dateTime']} />
          </Form.Item>
          <Form.Item field='isIdentifier' label={label('identifier')}>
            <Select
              options={[
                { label: label('yes'), value: 'yes' },
                { label: label('no'), value: 'no' },
              ]}
            />
          </Form.Item>
          <Form.Item field='description' label={label('description')}>
            <Input.TextArea />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title={label('editRelation')}
        visible={!!relationEditor}
        onCancel={() => setRelationEditor(undefined)}
        onOk={onSaveRelation}
        unmountOnExit
        footer={
          <Space>
            <Button
              status='danger'
              onClick={() => {
                onEdit({ ...model, relations: model.relations.filter((item) => item.id !== relationEditor?.id) });
                setRelationEditor(undefined);
              }}
            >
              {label('delete')}
            </Button>
            <Button onClick={() => setRelationEditor(undefined)}>{label('cancel')}</Button>
            <Button type='primary' onClick={() => void onSaveRelation()}>
              {label('apply')}
            </Button>
          </Space>
        }
      >
        <Form form={relationForm} layout='vertical'>
          <Form.Item field='name' label={label('name')} rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item field='fromObjectId' label={label('from')} rules={[{ required: true }]}>
            <Select options={model.objects.map((item) => ({ label: item.name, value: item.id }))} />
          </Form.Item>
          <Form.Item field='toObjectId' label={label('to')} rules={[{ required: true }]}>
            <Select options={model.objects.map((item) => ({ label: item.name, value: item.id }))} />
          </Form.Item>
          <Form.Item field='semanticType' label={label('relationKind')}>
            <Select
              options={[
                { label: label('association'), value: 'association' },
                { label: label('inheritance'), value: 'inheritance' },
              ]}
            />
          </Form.Item>
          <Form.Item field='cardinality' label={label('cardinality')}>
            <Select options={['unspecified', 'one_to_one', 'one_to_many', 'many_to_one', 'many_to_many'].map((value) => ({ label: label(value), value }))} />
          </Form.Item>
          <Form.Item field='description' label={label('description')}>
            <Input.TextArea />
          </Form.Item>
        </Form>
      </Modal>
    </section>
  );
}

interface IStudioModelEditorProps {
  workspaceId: string;
  model: IOntologyStudioModel;
  document?: IOntologySemanticDocument;
  onEditingChange: (isEditing: boolean) => void;
  focusObjectId?: string;
  focusIssue?: IOntologyConsistencyIssue;
  onChange: (model: IOntologyStudioModel) => void;
  onContext: (objectId: string) => void;
}

interface IOntologyNodeProps {
  data: IOntologyNodeData;
}
