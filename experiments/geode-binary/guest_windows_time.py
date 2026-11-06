"""Independent Gregorian calendar reference for valid Win32 UTC SYSTEMTIME."""
def systemtime_ticks(fields):
 year,month,weekday,day,hour,minute,second,millis=fields
 if not 1601<=year<=30827 or not 1<=month<=12 or hour>23 or minute>59 or second>59 or millis>999:return None
 leap=year%4==0 and (year%100!=0 or year%400==0)
 months=[31,29 if leap else 28,31,30,31,30,31,31,30,31,30,31]
 if not 1<=day<=months[month-1]:return None
 def leaps(y):return y//4-y//100+y//400
 days=(year-1601)*365+leaps(year-1)-leaps(1600)+sum(months[:month-1])+day-1
 return (((days*24+hour)*60+minute)*60+second)*10000000+millis*10000
