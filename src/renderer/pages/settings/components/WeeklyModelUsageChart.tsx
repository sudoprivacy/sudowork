import { DatePicker, Spin, Message } from '@arco-design/web-react';
import ReactECharts from 'echarts-for-react';
import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import dayjs, { Dayjs } from 'dayjs';
import { useModelUsageStats } from '@/renderer/hooks/useModelUsageStats';

const { RangePicker } = DatePicker;

const CHART_COLORS = [
  '#7583b2', // aou-6 (品牌色)
  '#165dff', // primary
  '#00b42a', // success
  '#ff7d00', // warning
  '#596590', // aou-7
  '#3f4868', // aou-8
  '#f53f3f', // danger
  '#b5bcd6', // aou-4
];

interface WeeklyModelUsageChartProps {
  className?: string;
}

const WeeklyModelUsageChart: React.FC<WeeklyModelUsageChartProps> = ({ className }) => {
  const { t } = useTranslation();
  const { data, loading, error, fetchStats } = useModelUsageStats();

  const [dateRange, setDateRange] = useState<[Date, Date]>(() => {
    const today = new Date();
    const weekAgo = new Date(today);
    weekAgo.setDate(today.getDate() - 7);
    return [weekAgo, today];
  });

  useEffect(() => {
    const startDate = dayjs(dateRange[0]).format('YYYY-MM-DD');
    const endDate = dayjs(dateRange[1]).format('YYYY-MM-DD');
    void fetchStats(startDate, endDate);
  }, [dateRange, fetchStats]);

  useEffect(() => {
    if (error) {
      Message.error(t('settings.modelUsage.loadFailed') || '加载模型用量数据失败');
    }
  }, [error, t]);

  const chartData = useMemo(() => {
    if (!data.length) return { dates: [], models: [], series: [] };

    const dateMap = new Map<string, Map<string, number>>();
    const modelsSet = new Set<string>();

    for (const item of data) {
      modelsSet.add(item.model);
      if (!dateMap.has(item.date)) {
        dateMap.set(item.date, new Map());
      }
      const modelData = dateMap.get(item.date)!;
      modelData.set(item.model, (modelData.get(item.model) || 0) + item.total_tokens);
    }

    const dates = Array.from(dateMap.keys()).sort();
    const models = Array.from(modelsSet);

    const series = models.map((model, index) => ({
      name: model,
      type: 'bar',
      stack: 'total',
      color: CHART_COLORS[index % CHART_COLORS.length],
      data: dates.map((date) => {
        const modelData = dateMap.get(date);
        return modelData?.get(model) || 0;
      }),
    }));

    return { dates, models, series };
  }, [data]);

  const chartOption = useMemo(() => {
    const getCSSVar = (name: string) => {
      const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return value || '#1d2129';
    };

    return {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: getCSSVar('--fill-0') || '#ffffff',
        borderColor: getCSSVar('--border-base') || '#e5e6eb',
        textStyle: { color: getCSSVar('--text-primary') || '#1d2129', fontFamily: 'PingFang SC, Microsoft YaHei, sans-serif' },
        formatter: (params: any) => {
          if (!params || !params.length) return '';
          const date = params[0].axisValue;
          let total = 0;
          const items = params
            .filter((p: any) => p.value > 0)
            .map((p: any) => {
              total += p.value;
              return `<div style="display:flex;justify-content:space-between;gap:12px"><span>${p.seriesName}</span><span style="font-weight:600">${p.value.toLocaleString()}</span></div>`;
            })
            .join('');
          return `<div style="font-weight:600;margin-bottom:8px">${date}</div>${items}<div style="display:flex;justify-content:space-between;gap:12px;margin-top:8px;border-top:1px solid var(--border-base);padding-top:8px"><span>总计</span><span style="font-weight:600">${total.toLocaleString()}</span></div>`;
        },
      },
      legend: {
        show: chartData.models.length > 1,
        top: 0,
        textStyle: { color: getCSSVar('--text-secondary') || '#86909c', fontFamily: 'PingFang SC, Microsoft YaHei, sans-serif' },
      },
      grid: {
        left: '3%',
        right: '4%',
        bottom: '3%',
        top: chartData.models.length > 1 ? '40px' : '20px',
        containLabel: true,
      },
      xAxis: {
        type: 'category',
        data: chartData.dates.map((d) => dayjs(d).format('MM-DD')),
        axisLabel: { color: getCSSVar('--text-secondary') || '#86909c', fontFamily: 'PingFang SC, Microsoft YaHei, sans-serif' },
        axisLine: { lineStyle: { color: getCSSVar('--border-base') || '#e5e6eb' } },
      },
      yAxis: {
        type: 'value',
        axisLabel: {
          color: getCSSVar('--text-secondary') || '#86909c',
          fontFamily: 'PingFang SC, Microsoft YaHei, sans-serif',
          formatter: (value: number) => {
            if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
            if (value >= 1000) return `${(value / 1000).toFixed(1)}K`;
            return value.toString();
          },
        },
        axisLine: { lineStyle: { color: getCSSVar('--border-base') || '#e5e6eb' } },
        splitLine: { lineStyle: { color: getCSSVar('--bg-3') || '#e5e6eb', type: 'dashed' } },
      },
      series: chartData.series,
    };
  }, [chartData]);

  const handleDateChange = (dateString: string[], date: Dayjs[]) => {
    if (date && date.length === 2) {
      const maxRange = 30;
      const daysDiff = Math.abs(date[1].diff(date[0], 'day'));
      if (daysDiff > maxRange) {
        Message.warning(t('settings.modelUsage.maxRangeWarning') || '时间范围不能超过30天');
        return;
      }
      setDateRange([date[0].toDate(), date[1].toDate()]);
    }
  };

  return (
    <div className={`p-24px bg-fill-0 rd-16px border border-border-base ${className || ''}`}>
      <div className='text-14px font-600 text-t-primary mb-16px'>{t('settings.modelUsage.title') || '模型用量'}</div>

      <div className='mb-16px'>
        <RangePicker value={dateRange} onChange={handleDateChange} format='YYYY-MM-DD' allowClear={false} style={{ width: '100%' }} placeholder={[t('settings.modelUsage.startDate') || '开始日期', t('settings.modelUsage.endDate') || '结束日期']} />
      </div>

      {loading ? (
        <div className='flex justify-center py-60px'>
          <Spin />
        </div>
      ) : !data.length ? (
        <div className='py-60px text-center text-t-tertiary text-14px'>{t('settings.modelUsage.noData') || '暂无模型用量数据'}</div>
      ) : (
        <ReactECharts option={chartOption} style={{ height: '300px' }} opts={{ renderer: 'canvas' }} />
      )}
    </div>
  );
};

export default WeeklyModelUsageChart;
