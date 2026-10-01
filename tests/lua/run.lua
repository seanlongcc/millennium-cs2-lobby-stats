package.path = './backend/?.lua;' .. package.path
local selected=arg[1]
local suites=selected and {selected} or {'steam','report','browser'}
local count=0
function test(name,fn)
 local ok,err=pcall(fn)
 if not ok then error(name .. ': ' .. tostring(err),0) end
 count=count+1; print('PASS ' .. name)
end
function eq(actual,expected) assert(actual==expected,tostring(actual)..' ~= '..tostring(expected)) end
for _,suite in ipairs(suites) do dofile('tests/lua/'..suite..'.test.lua') end
print(tostring(count)..' Lua tests passed')
